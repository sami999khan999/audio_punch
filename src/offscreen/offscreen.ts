/**
 * The audio engine host.
 *
 * A service worker cannot own an AudioContext — it is torn down whenever the
 * browser feels like it, which would cut playback mid-sentence. This offscreen
 * document exists solely to keep one AudioContext and the per-tab graphs
 * alive, and it takes its instructions from the service worker over a port.
 */
import { PORT_ENGINE, type EngineCommand, type EngineEvent } from '../shared/messages.ts'
import type { LevelReading } from '../shared/types.ts'
import { TabGraph } from './engine/graph.ts'
import { METER_FPS } from './engine/meter.ts'

const WORKLETS = ['worklets/pitch-shifter.js', 'worklets/gate.js']

const graphs = new Map<number, TabGraph>()
let ctx: AudioContext | null = null
let workletsLoaded: Promise<void> | null = null
let port: chrome.runtime.Port | null = null
let meterTimer: ReturnType<typeof setInterval> | null = null

function send(event: EngineEvent): void {
  port?.postMessage(event)
}

async function audioContext(): Promise<AudioContext> {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'playback' })
  }
  if (!workletsLoaded) {
    workletsLoaded = Promise.all(
      WORKLETS.map((path) => ctx!.audioWorklet.addModule(chrome.runtime.getURL(path))),
    ).then(() => undefined)
  }
  await workletsLoaded

  // Chrome may start the context suspended; arming happens on a user gesture,
  // so this is the right moment to resume.
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => undefined)
  }
  return ctx
}

type AttachCommand = Extract<EngineCommand, { type: 'engine:attach' }>

async function attach(command: AttachCommand): Promise<void> {
  const { tabId, streamId } = command
  detach(tabId)
  const audio = await audioContext()

  // The tab-capture constraints are non-standard, hence the cast.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
  } as unknown as MediaStreamConstraints)

  const graph = new TabGraph(audio, tabId, stream)
  graphs.set(tabId, graph)
  graph.onEnded(() => {
    graphs.delete(tabId)
    graph.dispose()
    send({ type: 'engine:ended', tabId })
  })
  graph.apply(command.chain)
  send({ type: 'engine:attached', tabId })
}

function detach(tabId: number): void {
  const graph = graphs.get(tabId)
  if (!graph) return
  graphs.delete(tabId)
  graph.dispose()
}

function setMetering(enabled: boolean): void {
  if (enabled && !meterTimer) {
    meterTimer = setInterval(() => {
      if (graphs.size === 0) return
      const levels: Record<number, LevelReading> = {}
      for (const [tabId, graph] of graphs) levels[tabId] = graph.readMeter()
      send({ type: 'engine:meters', levels })
    }, Math.round(1000 / METER_FPS))
  } else if (!enabled && meterTimer) {
    clearInterval(meterTimer)
    meterTimer = null
  }
}

async function handle(command: EngineCommand): Promise<void> {
  switch (command.type) {
    case 'engine:attach':
      await attach(command)
      break
    case 'engine:detach':
      detach(command.tabId)
      break
    case 'engine:detach-all':
      for (const tabId of [...graphs.keys()]) detach(tabId)
      setMetering(false)
      break
    case 'engine:chain': {
      graphs.get(command.tabId)?.apply(command.chain)
      break
    }
    case 'engine:meters':
      setMetering(command.enabled)
      break
  }
}

let reconnectDelay = 250

function connect(): void {
  port = chrome.runtime.connect({ name: PORT_ENGINE })
  reconnectDelay = 250
  port.onMessage.addListener((message: EngineCommand) => {
    handle(message).catch((err) => {
      const tabId = 'tabId' in message && typeof message.tabId === 'number' ? message.tabId : null
      send({
        type: 'engine:error',
        tabId,
        message: err instanceof Error ? err.message : String(err),
      })
    })
  })
  port.onDisconnect.addListener(() => {
    port = null
    // The service worker went to sleep. Keep every graph running — audio must
    // not drop just because the worker was evicted — and reconnect when it
    // comes back. Metering is the one thing worth pausing: nothing is
    // listening for it until a UI reconnects.
    setMetering(false)
    setTimeout(connect, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 10_000)
  })
  send({ type: 'engine:ready' })
}

connect()

// A restarted service worker also pokes us directly, so the engine comes back
// immediately rather than waiting out the backoff above.
chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type === 'engine:reconnect' && !port) connect()
})

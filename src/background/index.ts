/**
 * Service worker — the coordinator.
 *
 * Owns the settings, the tab registry and the connection to the audio engine.
 * The overlay and the dashboard hold no authoritative state of their own: they
 * send intents and render the snapshot they get back, which is what keeps two
 * open surfaces (and the global strip inside each) consistent for free.
 */
import { chromePlatform } from '../platform/chrome.ts'
import {
  PORT_ENGINE,
  PORT_UI,
  type Broadcast,
  type ContentCommand,
  type EngineCommand,
  type EngineEvent,
  type ToBackground,
  type UiRequest,
  type UiResponse,
} from '../shared/messages.ts'
import { applyImport, makeExport, validateImport } from '../shared/migrate.ts'
import { isDrmOrigin, originOf } from '../shared/origin.ts'
import type { LevelReading, StateSnapshot } from '../shared/types.ts'
import { SettingsStore } from './settings.ts'
import { TabRegistry } from './tab-registry.ts'
import { resolveChain } from './resolve.ts'

const platform = chromePlatform
const store = new SettingsStore(platform)
const registry = new TabRegistry(platform)

let enginePort: chrome.runtime.Port | null = null
let engineReady = false
const uiPorts = new Set<chrome.runtime.Port>()
let lastLevels: Record<number, LevelReading> = {}

// ---------------------------------------------------------------- plumbing

function toEngine(command: EngineCommand): void {
  enginePort?.postMessage(command)
}

function broadcast(message: Broadcast): void {
  for (const port of uiPorts) {
    try {
      port.postMessage(message)
    } catch {
      uiPorts.delete(port)
    }
  }
}

function toast(kind: 'info' | 'warn' | 'error', text: string): void {
  broadcast({ type: 'toast', kind, text })
}

async function snapshot(selfTabId: number | null): Promise<StateSnapshot> {
  await registry.refresh()
  return {
    settings: store.current(),
    tabs: registry.list(),
    selfTabId,
    engineReady,
  }
}

async function publishState(): Promise<void> {
  const snap = await snapshot(null)
  for (const port of uiPorts) {
    const tabId = port.sender?.tab?.id ?? null
    try {
      port.postMessage({ type: 'state', snapshot: { ...snap, selfTabId: tabId } })
    } catch {
      uiPorts.delete(port)
    }
  }
}

/** Pushes the resolved chain for every armed tab down to the engine. */
async function syncEngine(): Promise<void> {
  const settings = store.current()
  for (const tabId of registry.armedTabs()) {
    const origin = await registry.originFor(tabId)
    const chain = resolveChain(settings, origin)
    toEngine({ type: 'engine:chain', tabId, chain })
    await syncPlaybackRate(tabId, chain.speed.on && !chain.bypass ? chain.speed.rate : 1)
  }
}

/**
 * Playback speed is not something the audio graph can do under tab capture —
 * it has to be set on the page's own media elements, so it travels to the
 * content script instead of the engine.
 *
 * Only sent on an actual change: syncEngine runs on every knob movement, and
 * messaging a content script sixty times a second to tell it nothing changed
 * is a waste on both ends.
 */
const sentRates = new Map<number, number>()

async function syncPlaybackRate(tabId: number, rate: number): Promise<void> {
  if (sentRates.get(tabId) === rate) return
  sentRates.set(tabId, rate)
  await platform.tabs.sendMessage(tabId, { type: 'content:set-rate', rate } satisfies ContentCommand)
}

// ------------------------------------------------------------------ arming

async function armTab(tabId: number, opts: { viaActivation?: boolean; confirmDrm?: boolean } = {}): Promise<void> {
  const origin = await registry.originFor(tabId)
  if (!origin) {
    toast('warn', 'This page cannot be captured.')
    return
  }
  if (isDrmOrigin(origin) && !opts.confirmDrm) {
    toast(
      'warn',
      'This site uses protected playback. Capturing it will silence the tab — arm again to try anyway.',
    )
    registry.markBlocked(tabId, 'drm')
    await publishState()
    return
  }

  await platform.ensureEngine()
  const outcome = opts.viaActivation ? await registry.armViaActivation(tabId) : await registry.arm(tabId)

  if (!outcome.ok) {
    if (outcome.needsActivation) {
      toast('warn', 'Switch to that tab (or press the shortcut there) to let the browser hand over its audio.')
    } else {
      toast('error', outcome.error ?? 'The browser refused to capture this tab.')
    }
    await publishState()
    return
  }

  if (outcome.streamId) {
    toEngine({
      type: 'engine:attach',
      tabId,
      streamId: outcome.streamId,
      chain: resolveChain(store.current(), origin),
    })
  }
  const chain = resolveChain(store.current(), origin)
  await syncPlaybackRate(tabId, chain.speed.on && !chain.bypass ? chain.speed.rate : 1)
  await publishState()
}

async function releaseTab(tabId: number): Promise<void> {
  registry.release(tabId)
  toEngine({ type: 'engine:detach', tabId })
  // Releasing must hand the page back exactly as we found it, speed included.
  await syncPlaybackRate(tabId, 1)
  sentRates.delete(tabId)
  await publishState()
}

// ------------------------------------------------------------- UI requests

async function handleUiRequest(request: UiRequest, senderTabId: number | null): Promise<UiResponse> {
  switch (request.type) {
    case 'ui:hello':
      return { ok: true, snapshot: await snapshot(senderTabId) }

    case 'ui:patch-chain':
      store.patchChain(request.target, request.patch)
      await syncEngine()
      return { ok: true }

    case 'ui:reset-chain':
      store.resetChain(request.target)
      await syncEngine()
      return { ok: true }

    case 'ui:set-global-on':
      store.update((s) => {
        s.global.on = request.on
      })
      await syncEngine()
      return { ok: true }

    case 'ui:set-ignore-global':
      store.setIgnoreGlobal(request.origin, request.value)
      await syncEngine()
      return { ok: true }

    case 'ui:arm':
      await armTab(request.tabId, { viaActivation: senderTabId !== request.tabId, confirmDrm: request.confirmDrm })
      return { ok: true }

    case 'ui:release':
      await releaseTab(request.tabId)
      return { ok: true }

    case 'ui:mute-all':
      store.update((s) => {
        s.muteAll = request.value ?? !s.muteAll
      })
      await syncEngine()
      return { ok: true }

    case 'ui:bypass-all':
      store.update((s) => {
        s.bypassAll = request.value ?? !s.bypassAll
      })
      await syncEngine()
      return { ok: true }

    case 'ui:save-template': {
      const template = store.saveTemplate(
        request.name,
        request.description,
        request.modules,
        request.source,
      )
      toast('info', `Saved template "${template.name}".`)
      return { ok: true, template }
    }

    case 'ui:apply-template':
      try {
        store.applyTemplate(request.templateId, request.target)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      await syncEngine()
      return { ok: true }

    case 'ui:remove-template':
      store.removeTemplate(request.target)
      await syncEngine()
      return { ok: true }

    case 'ui:delete-template':
      store.deleteTemplate(request.templateId)
      await syncEngine()
      return { ok: true }

    case 'ui:rename-template':
      store.renameTemplate(request.templateId, request.name, request.description)
      return { ok: true }

    case 'ui:reorder-templates':
      store.reorderTemplates(request.order)
      return { ok: true }

    case 'ui:set-ui-prefs':
      store.update((s) => {
        Object.assign(s.ui, request.patch)
      })
      return { ok: true }

    case 'ui:set-keymap':
      store.update((s) => {
        s.keymap = request.keymap
      })
      return { ok: true }

    case 'ui:forget-site':
      store.forgetSite(request.origin)
      await syncEngine()
      return { ok: true }

    case 'ui:export':
      return { ok: true, settings: makeExport(store.current()).settings }

    case 'ui:import': {
      const result = validateImport(request.payload)
      if (!result.ok) return { ok: false, error: result.error }
      store.replaceAll(applyImport(store.current(), result.settings, request.mode))
      await store.flush()
      await syncEngine()
      for (const warning of result.warnings) toast('warn', warning)
      toast('info', request.mode === 'replace' ? 'Settings replaced.' : 'Settings merged.')
      return { ok: true, snapshot: await snapshot(senderTabId) }
    }

    case 'ui:open-dashboard':
      await platform.openDashboard()
      return { ok: true }

    case 'ui:meters':
      toEngine({ type: 'engine:meters', enabled: request.enabled && store.current().ui.meters })
      return { ok: true }
  }
}

// ------------------------------------------------------------------- ports

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PORT_ENGINE) {
    enginePort = port
    port.onMessage.addListener((event: EngineEvent) => {
      void handleEngineEvent(event)
    })
    port.onDisconnect.addListener(() => {
      enginePort = null
      engineReady = false
    })
    return
  }

  if (port.name !== PORT_UI) return
  uiPorts.add(port)
  const senderTabId = port.sender?.tab?.id ?? null

  port.onMessage.addListener((message: UiRequest & { requestId?: number }) => {
    void handleUiRequest(message, senderTabId)
      .then(async (response) => {
        if (message.requestId !== undefined) {
          port.postMessage({ requestId: message.requestId, response })
        }
        await publishState()
      })
      .catch((err) => {
        const response: UiResponse = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }
        if (message.requestId !== undefined) {
          port.postMessage({ requestId: message.requestId, response })
        }
      })
  })

  port.onDisconnect.addListener(() => {
    uiPorts.delete(port)
    if (uiPorts.size === 0) toEngine({ type: 'engine:meters', enabled: false })
  })

  void (async () => {
    await store.load()
    port.postMessage({ type: 'state', snapshot: await snapshot(senderTabId) })
  })()
})

async function handleEngineEvent(event: EngineEvent): Promise<void> {
  switch (event.type) {
    case 'engine:ready':
      engineReady = true
      await publishState()
      break
    case 'engine:attached':
      await publishState()
      break
    case 'engine:ended':
      registry.release(event.tabId)
      await publishState()
      break
    case 'engine:error':
      if (event.tabId !== null) registry.markBlocked(event.tabId, 'capture-failed')
      toast('error', event.message)
      await publishState()
      break
    case 'engine:meters':
      lastLevels = event.levels
      broadcast({ type: 'meters', levels: lastLevels })
      break
  }
}

// -------------------------------------------------------- one-shot messages

chrome.runtime.onMessage.addListener((message: ToBackground, sender, sendResponse) => {
  const senderTabId = sender.tab?.id ?? null

  if (message?.type === 'content:media-report') {
    if (senderTabId !== null) registry.setMediaPresence(senderTabId, message.hasMediaElements)
    void publishState()
    sendResponse({ ok: true })
    return false
  }

  void store
    .load()
    .then(() => handleUiRequest(message as UiRequest, senderTabId))
    .then((response) => sendResponse(response))
    .catch((err) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    )
  return true // response is asynchronous
})

// ---------------------------------------------------------------- commands

/**
 * The four browser-level shortcuts. Everything else is handled in the overlay,
 * where there is no four-binding cap — see `src/content/keymap.ts`.
 */
chrome.commands.onCommand.addListener((command, tab) => {
  void (async () => {
    await store.load()
    const tabId = tab?.id ?? null

    switch (command) {
      case 'toggle-overlay':
        if (tabId === null) break
        // The shortcut is itself the user gesture that lets us capture this
        // tab, so take the opportunity while we have it.
        if (!registry.isArmed(tabId)) await armTab(tabId)
        await platform.tabs.sendMessage(tabId, { type: 'content:toggle-overlay' } satisfies ContentCommand)
        break

      case 'toggle-global':
        store.update((s) => {
          s.global.on = !s.global.on
        })
        toast('info', store.current().global.on ? 'Global chain on' : 'Global chain off')
        await syncEngine()
        break

      case 'mute-all':
        store.update((s) => {
          s.muteAll = !s.muteAll
        })
        toast('info', store.current().muteAll ? 'All tabs muted' : 'Mute released')
        await syncEngine()
        break

      case 'bypass-all':
        store.update((s) => {
          s.bypassAll = !s.bypassAll
        })
        toast('info', store.current().bypassAll ? 'Processing bypassed' : 'Processing re-engaged')
        await syncEngine()
        break
    }
    await publishState()
  })()
})

chrome.action.onClicked.addListener((tab) => {
  void (async () => {
    await store.load()
    if (tab.id === undefined) return
    if (!registry.isArmed(tab.id)) await armTab(tab.id)
    await platform.tabs.sendMessage(tab.id, { type: 'content:open-overlay' } satisfies ContentCommand)
  })()
})

// ------------------------------------------------------------- tab lifecycle

chrome.tabs.onRemoved.addListener((tabId) => {
  registry.release(tabId)
  sentRates.delete(tabId)
  toEngine({ type: 'engine:detach', tabId })
  void publishState()
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void (async () => {
    await store.load()
    // A navigation within the same origin keeps the capture valid, so only
    // re-resolve; a cross-origin navigation needs a different chain.
    if (changeInfo.url && registry.isArmed(tabId)) {
      const origin = originOf(changeInfo.url)
      if (origin) {
        const chain = resolveChain(store.current(), origin)
        toEngine({ type: 'engine:chain', tabId, chain })
        // A navigation replaces the media elements, so the rate must be resent
        // even when its value is unchanged.
        sentRates.delete(tabId)
        await syncPlaybackRate(tabId, chain.speed.on && !chain.bypass ? chain.speed.rate : 1)
      }
    }
    if (changeInfo.audible !== undefined || changeInfo.status === 'complete' || changeInfo.url) {
      await publishState()
    }
  })()
})

chrome.runtime.onStartup.addListener(() => {
  void store.load()
})

chrome.runtime.onInstalled.addListener(() => {
  void store.load()
})

// Bring the engine back if this worker restarted while graphs were still live.
void (async () => {
  await store.load()
  await platform.ensureEngine().catch(() => undefined)
  chrome.runtime.sendMessage({ type: 'engine:reconnect' }).catch(() => undefined)
})()

/**
 * The audio engine, running in the page's content script.
 *
 * Each `<audio>`/`<video>` on the page is routed through `createMediaElementSource`
 * into one shared processing graph. This replaces the earlier tab-capture
 * design, which cost a permanent "sharing this tab" indicator from the browser,
 * silenced DRM playback, and needed a user gesture to arm every tab.
 *
 * Two rules this file exists to respect:
 *
 * 1. `createMediaElementSource` may be called **once** per element, ever. Call
 *    it twice and the browser throws. Hence the WeakMap.
 * 2. Once an element is routed, its audio no longer reaches the speakers by
 *    itself. If the graph is not connected through to the destination, the page
 *    goes silent — a far worse failure than an effect not applying.
 */
import type { ChainState, LevelReading } from '../shared/types.ts'
import { PageGraph } from '../engine/graph.ts'

const WORKLETS = ['worklets/pitch-shifter.js', 'worklets/gate.js']

/** How long a hooked, playing element may show no signal before we warn. */
const SILENCE_GRACE_MS = 2500

export interface EngineStatus {
  /** Elements currently routed through the graph. */
  hooked: number
  /** Set when a hooked element is playing but no audio is reaching the graph. */
  silent: boolean
  running: boolean
}

export class ContentEngine {
  private ctx: AudioContext | null = null
  private graph: PageGraph | null = null
  private ready: Promise<void> | null = null
  private readonly sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()
  private readonly hooked = new Set<HTMLMediaElement>()
  /** Elements the browser refused to route, so scans stop retrying them. */
  private readonly refused = new WeakSet<HTMLMediaElement>()
  private chain: ChainState | null = null
  private silentSince: number | null = null
  private reportedSilent = false

  constructor(private readonly onStatus: (status: EngineStatus) => void) {}

  /**
   * The context is created lazily, on the first hook. A page that never plays
   * anything should not pay for an AudioContext.
   */
  private async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.ready = Promise.all(
        WORKLETS.map((path) => this.ctx!.audioWorklet.addModule(chrome.runtime.getURL(path))),
      ).then(() => {
        this.graph = new PageGraph(this.ctx!)
        if (this.chain) this.graph.apply(this.chain)
      })
    }
    await this.ready
    return this.ctx
  }

  /**
   * Routes one element into the graph. Safe to call repeatedly — elements
   * already hooked are ignored, which is what makes it usable from a
   * MutationObserver.
   */
  async hook(element: HTMLMediaElement): Promise<void> {
    if (this.sources.has(element) || this.refused.has(element)) return
    const ctx = await this.ensureContext()
    if (!this.graph) return

    let source: MediaElementAudioSourceNode
    try {
      source = ctx.createMediaElementSource(element)
    } catch {
      // Already routed by another script, or the element is in a state the
      // browser refuses. Leaving it on the normal playback path is correct:
      // the audio still plays, it just is not processed. Remembered so the
      // next DOM scan does not try again, and again.
      this.refused.add(element)
      return
    }
    this.sources.set(element, source)
    this.hooked.add(element)
    source.connect(this.graph.input)

    // The context starts suspended until a gesture; playing counts as one.
    element.addEventListener('play', () => void this.resume(), { passive: true })
    if (!element.paused) void this.resume()
    this.emit()
  }

  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') {
      await this.ctx.resume().catch(() => undefined)
      this.emit()
    }
  }

  apply(chain: ChainState): void {
    this.chain = chain
    this.graph?.apply(chain)
  }

  /**
   * Reads the output level, and watches for the one failure mode this engine
   * has: an element whose audio is cross-origin without CORS headers routes
   * into the graph as pure silence. The element reports playing, the page is
   * quiet, and nothing throws — so detect it and say so rather than let the
   * user think the extension is broken.
   */
  readLevel(): LevelReading | null {
    if (!this.graph) return null
    const reading = this.graph.readMeter()

    // Silence we caused ourselves is not a fault. The meter sits after the
    // output gain, so a muted or fully-closed chain reads zero by design, and
    // warning about it would be telling the user their own mute is broken.
    const silencedByChain =
      this.chain !== null && (this.chain.gain.mute || this.chain.gain.level === 0)
    const playing =
      !silencedByChain && [...this.hooked].some((el) => !el.paused && !el.muted && el.volume > 0)

    if (!playing || reading.peak > 0.0005) {
      this.silentSince = null
      if (this.reportedSilent) {
        this.reportedSilent = false
        this.emit()
      }
      return reading
    }

    const now = Date.now()
    this.silentSince ??= now
    if (!this.reportedSilent && now - this.silentSince > SILENCE_GRACE_MS) {
      this.reportedSilent = true
      this.emit()
    }
    return reading
  }

  status(): EngineStatus {
    return {
      hooked: this.hooked.size,
      silent: this.reportedSilent,
      running: this.ctx?.state === 'running',
    }
  }

  private emit(): void {
    this.onStatus(this.status())
  }

  /**
   * Releasing is deliberately partial: a routed element cannot be un-routed,
   * so the graph is flattened to unity instead of torn down. Disposing the
   * context here would silence the page permanently.
   */
  release(): void {
    this.graph?.bypass()
  }
}

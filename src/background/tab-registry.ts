/**
 * Tracks every tab worth showing in the mixer and owns the arming flow.
 *
 * Arming is the awkward part of tab capture: the browser only hands over a
 * stream for a tab the extension has been *invoked on*. Pressing the shortcut
 * or clicking the toolbar button counts; clicking "Arm" on a strip for some
 * other tab does not. When capture is refused for that reason we say so
 * plainly rather than failing silently, and the UI offers to switch to the tab.
 */
import { isDrmOrigin, isSupportedPage, originOf } from '../shared/origin.ts'
import type { TabBlockReason, TabInfo } from '../shared/types.ts'
import type { Platform, PlatformTab } from '../platform/index.ts'

export interface ArmOutcome {
  ok: boolean
  /** Set when the failure is the missing-gesture case, which is recoverable. */
  needsActivation?: boolean
  error?: string
  streamId?: string
}

export class TabRegistry {
  private readonly armed = new Set<number>()
  private readonly arming = new Set<number>()
  private readonly blocked = new Map<number, TabBlockReason>()
  private readonly hasMedia = new Map<number, boolean>()
  private cache: PlatformTab[] = []

  constructor(private readonly platform: Platform) {}

  async refresh(): Promise<void> {
    this.cache = await this.platform.tabs.list()
    const live = new Set(this.cache.map((t) => t.id))
    for (const id of [...this.armed]) if (!live.has(id)) this.armed.delete(id)
    for (const id of [...this.blocked.keys()]) if (!live.has(id)) this.blocked.delete(id)
    for (const id of [...this.hasMedia.keys()]) if (!live.has(id)) this.hasMedia.delete(id)
  }

  /**
   * Tabs the mixer shows: anything currently making sound, anything already
   * armed, and anything that has reported media elements. A tab that has never
   * played anything is noise in the strip list.
   */
  list(): TabInfo[] {
    return this.cache
      .filter((tab) => {
        if (!isSupportedPage(tab.url)) return false
        return tab.audible || this.armed.has(tab.id) || this.hasMedia.get(tab.id) === true
      })
      .map((tab) => this.describe(tab))
      .sort((a, b) => {
        if (a.armed !== b.armed) return a.armed ? -1 : 1
        if (a.audible !== b.audible) return a.audible ? -1 : 1
        return a.title.localeCompare(b.title)
      })
  }

  describe(tab: PlatformTab): TabInfo {
    const origin = originOf(tab.url)
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      origin,
      title: tab.title || origin,
      favIconUrl: tab.favIconUrl,
      audible: tab.audible,
      armed: this.armed.has(tab.id),
      arming: this.arming.has(tab.id),
      blocked: this.blocked.get(tab.id) ?? (isDrmOrigin(origin) ? 'drm' : null),
      hasMediaElements: this.hasMedia.get(tab.id) === true,
      active: tab.active,
    }
  }

  async info(tabId: number): Promise<TabInfo | null> {
    const tab = this.cache.find((t) => t.id === tabId) ?? (await this.platform.tabs.get(tabId))
    return tab ? this.describe(tab) : null
  }

  async originFor(tabId: number): Promise<string> {
    const tab = this.cache.find((t) => t.id === tabId) ?? (await this.platform.tabs.get(tabId))
    return originOf(tab?.url)
  }

  isArmed(tabId: number): boolean {
    return this.armed.has(tabId)
  }

  armedTabs(): number[] {
    return [...this.armed]
  }

  setMediaPresence(tabId: number, present: boolean): void {
    this.hasMedia.set(tabId, present)
  }

  /** Requests a capture stream id, classifying failures the UI can act on. */
  async arm(tabId: number): Promise<ArmOutcome> {
    if (this.armed.has(tabId)) return { ok: true }
    this.arming.add(tabId)
    try {
      const { streamId } = await this.platform.captureTab(tabId)
      this.armed.add(tabId)
      this.blocked.delete(tabId)
      return { ok: true, streamId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Chrome phrases this a few different ways across versions; all of them
      // mean the same thing — we were not invoked on that tab.
      const needsActivation = /invoked|active tab|activeTab|gesture|permission/i.test(message)
      if (!needsActivation) this.blocked.set(tabId, 'capture-failed')
      return { ok: false, needsActivation, error: message }
    } finally {
      this.arming.delete(tabId)
    }
  }

  /**
   * Brings a tab to the front and arms it there. This is the recovery path for
   * the missing-gesture case — switching tabs is intrusive, so it only runs
   * when the user explicitly asks for it from the strip.
   */
  async armViaActivation(tabId: number): Promise<ArmOutcome> {
    const target = this.cache.find((t) => t.id === tabId)
    const previous = target
      ? this.cache.find((t) => t.active && t.windowId === target.windowId)
      : undefined
    await this.platform.tabs.activate(tabId)
    try {
      return await this.arm(tabId)
    } finally {
      // Hand the user back the tab they were looking at. The capture survives
      // the switch back, so this costs nothing but a flicker.
      if (previous && previous.id !== tabId) {
        await this.platform.tabs.activate(previous.id).catch(() => undefined)
      }
    }
  }

  release(tabId: number): void {
    this.armed.delete(tabId)
    this.arming.delete(tabId)
  }

  releaseAll(): void {
    this.armed.clear()
    this.arming.clear()
  }

  markBlocked(tabId: number, reason: TabBlockReason): void {
    this.armed.delete(tabId)
    if (reason) this.blocked.set(tabId, reason)
    else this.blocked.delete(tabId)
  }
}

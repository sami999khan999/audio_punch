/**
 * Tracks the tabs worth showing in the mixer.
 *
 * Far simpler than the tab-capture version this replaces: there is no arming,
 * no user gesture to chase and no permission to be refused. A page is
 * processed as soon as its content script hooks a media element, so the
 * registry only has to remember what each page has reported.
 */
import { isSupportedPage, originOf } from '../shared/origin.ts'
import type { TabInfo } from '../shared/types.ts'
import type { Platform, PlatformTab } from '../platform/index.ts'

interface Report {
  hasMediaElements: boolean
  count: number
  hooked: number
  silent: boolean
}

const EMPTY: Report = { hasMediaElements: false, count: 0, hooked: 0, silent: false }

export class TabRegistry {
  private readonly reports = new Map<number, Report>()
  private cache: PlatformTab[] = []

  constructor(private readonly platform: Platform) {}

  async refresh(): Promise<void> {
    this.cache = await this.platform.tabs.list()
    const live = new Set(this.cache.map((t) => t.id))
    for (const id of [...this.reports.keys()]) {
      if (!live.has(id)) this.reports.delete(id)
    }
  }

  /**
   * Tabs the mixer shows: anything making sound, and anything that has
   * reported a media element. A tab that has never had audio is noise in the
   * strip list.
   */
  list(): TabInfo[] {
    return this.cache
      .filter((tab) => {
        if (!isSupportedPage(tab.url)) return false
        return tab.audible || this.reports.get(tab.id)?.hasMediaElements === true
      })
      .map((tab) => this.describe(tab))
      .sort((a, b) => {
        if (a.audible !== b.audible) return a.audible ? -1 : 1
        if (a.hooked !== b.hooked) return b.hooked - a.hooked
        return a.title.localeCompare(b.title)
      })
  }

  describe(tab: PlatformTab): TabInfo {
    const origin = originOf(tab.url)
    const report = this.reports.get(tab.id) ?? EMPTY
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      origin,
      title: tab.title || origin,
      favIconUrl: tab.favIconUrl,
      audible: tab.audible,
      active: tab.active,
      hasMediaElements: report.hasMediaElements,
      hooked: report.hooked,
      silent: report.silent,
    }
  }

  async originFor(tabId: number): Promise<string> {
    const tab = this.cache.find((t) => t.id === tabId) ?? (await this.platform.tabs.get(tabId))
    return originOf(tab?.url)
  }

  /** Every tab currently running the engine, for chain broadcasts. */
  processedTabs(): number[] {
    return [...this.reports.entries()]
      .filter(([, report]) => report.hasMediaElements)
      .map(([tabId]) => tabId)
  }

  record(tabId: number, report: Report): void {
    this.reports.set(tabId, report)
  }

  forget(tabId: number): void {
    this.reports.delete(tabId)
  }
}

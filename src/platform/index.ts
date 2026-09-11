/**
 * The browser-API boundary.
 *
 * Everything above this layer (state, resolution, templates, DSP, UI) is
 * written against these interfaces, so adding Firefox later means writing one
 * more adapter rather than touching the rest of the extension.
 */
export interface PlatformTab {
  id: number
  windowId: number
  url: string
  title: string
  favIconUrl: string
  audible: boolean
  active: boolean
}

export interface Platform {
  readonly name: 'chrome' | 'firefox'

  storage: {
    read<T>(key: string): Promise<T | null>
    write(key: string, value: unknown): Promise<void>
    clear(key: string): Promise<void>
  }

  tabs: {
    list(): Promise<PlatformTab[]>
    get(tabId: number): Promise<PlatformTab | null>
    activate(tabId: number): Promise<void>
    sendMessage(tabId: number, message: unknown): Promise<unknown>
  }

  openDashboard(): Promise<void>

  notify(text: string): void
}


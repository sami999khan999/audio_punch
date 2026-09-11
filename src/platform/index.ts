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

export interface CaptureHandle {
  /** Opaque id handed to the engine so it can open the stream. */
  streamId: string
}

export interface Platform {
  readonly name: 'chrome' | 'firefox'

  /** True when this browser can route a whole tab through the engine. */
  readonly canCaptureTabs: boolean

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

  /**
   * Starts capture of one tab. Rejects when the browser refuses — most often
   * because the extension has not been invoked on that tab, which is the
   * gesture requirement the "Arm" button exists to satisfy.
   */
  captureTab(tabId: number): Promise<CaptureHandle>

  /** Ensures the audio engine host exists and is listening. */
  ensureEngine(): Promise<void>

  openDashboard(): Promise<void>

  notify(text: string): void
}


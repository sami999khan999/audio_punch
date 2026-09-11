/**
 * UI state and the connection to the service worker.
 *
 * The service worker owns the settings; this holds the last snapshot it sent
 * plus the bits that are purely local to one surface (which strip is selected,
 * which EQ band has keyboard focus, whether the overlay is open). Controls
 * subscribe to the slice they care about and mutate their own DOM, which is
 * how ~40 live controls stay in sync without a diffing framework.
 */
import { PORT_UI, type Broadcast, type UiRequest, type UiResponse } from '../../shared/messages.ts'
import { defaultSettings } from '../../shared/defaults.ts'
import type { LevelReading, StateSnapshot, TargetKey, TabInfo } from '../../shared/types.ts'

export interface Toast {
  id: number
  kind: 'info' | 'warn' | 'error'
  text: string
}

export interface UiState {
  snapshot: StateSnapshot
  /** Which strip the rack is editing. */
  target: TargetKey
  /** The tab backing the selected strip, when it is a tab strip. */
  targetTabId: number | null
  levels: Record<number, LevelReading>
  toasts: Toast[]
  /** Band index the EQ keyboard shortcuts act on. */
  eqBand: number
  open: boolean
  connected: boolean
}

const EMPTY_SNAPSHOT: StateSnapshot = {
  settings: defaultSettings(),
  tabs: [],
  selfTabId: null,
  engineReady: false,
}

type Listener = (state: UiState) => void

export class UiStore {
  private state: UiState = {
    snapshot: EMPTY_SNAPSHOT,
    target: 'global',
    targetTabId: null,
    levels: {},
    toasts: [],
    eqBand: 0,
    open: false,
    connected: false,
  }

  private readonly listeners = new Set<Listener>()
  private port: chrome.runtime.Port | null = null
  private nextRequestId = 1
  private readonly pending = new Map<number, (response: UiResponse) => void>()
  private nextToastId = 1

  get(): UiState {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  /** Applies a local change and notifies subscribers. */
  set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  // ------------------------------------------------------------ connection

  connect(): void {
    if (this.port) return
    this.port = chrome.runtime.connect({ name: PORT_UI })
    this.set({ connected: true })

    this.port.onMessage.addListener((message: Broadcast | { requestId: number; response: UiResponse }) => {
      if ('requestId' in message) {
        this.pending.get(message.requestId)?.(message.response)
        this.pending.delete(message.requestId)
        return
      }
      this.receive(message)
    })

    this.port.onDisconnect.addListener(() => {
      this.port = null
      this.set({ connected: false })
      // The worker was evicted; reconnecting is cheap and it will replay state.
      setTimeout(() => this.connect(), 400)
    })
  }

  private receive(message: Broadcast): void {
    switch (message.type) {
      case 'state': {
        const snapshot = message.snapshot
        this.set({ snapshot, ...this.reconcileTarget(snapshot) })
        break
      }
      case 'meters':
        this.set({ levels: message.levels })
        break
      case 'toast':
        this.pushToast(message.kind, message.text)
        break
      case 'overlay:toggle':
        this.set({ open: !this.state.open })
        break
      case 'overlay:open':
        this.set({ open: true })
        break
    }
  }

  /**
   * Keeps the selection valid as tabs come and go. Falling back to the tab the
   * overlay is running in — rather than to global — matches what someone
   * pressing the shortcut on a noisy page is asking for.
   */
  private reconcileTarget(snapshot: StateSnapshot): Pick<UiState, 'target' | 'targetTabId'> {
    const { target, targetTabId } = this.state
    if (targetTabId !== null && snapshot.tabs.some((t) => t.tabId === targetTabId)) {
      return { target, targetTabId }
    }
    if (target === 'global' && targetTabId === null) {
      const own = snapshot.tabs.find((t) => t.tabId === snapshot.selfTabId)
      if (own) return { target: `site:${own.origin}`, targetTabId: own.tabId }
      return { target: 'global', targetTabId: null }
    }
    const own = snapshot.tabs.find((t) => t.tabId === snapshot.selfTabId)
    if (own) return { target: `site:${own.origin}`, targetTabId: own.tabId }
    return { target: 'global', targetTabId: null }
  }

  send(request: UiRequest): Promise<UiResponse> {
    if (!this.port) {
      this.connect()
    }
    const requestId = this.nextRequestId++
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve)
      try {
        this.port?.postMessage({ ...request, requestId })
      } catch {
        this.pending.delete(requestId)
        resolve({ ok: false, error: 'Lost the connection to Audio Punch. Try again.' })
      }
    })
  }

  /** Fire-and-forget for high-frequency updates like knob drags. */
  push(request: UiRequest): void {
    if (!this.port) this.connect()
    try {
      this.port?.postMessage(request)
    } catch {
      // Dropped while the worker restarts; the next drag frame will land.
    }
  }

  // ---------------------------------------------------------------- toasts

  pushToast(kind: Toast['kind'], text: string): void {
    const toast: Toast = { id: this.nextToastId++, kind, text }
    this.set({ toasts: [...this.state.toasts, toast] })
    setTimeout(() => this.dismissToast(toast.id), kind === 'error' ? 7000 : 4200)
  }

  dismissToast(id: number): void {
    this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) })
  }

  // ------------------------------------------------------------- selection

  selectTarget(target: TargetKey, tabId: number | null): void {
    this.set({ target, targetTabId: tabId })
  }

  selectedTab(): TabInfo | null {
    const { targetTabId, snapshot } = this.state
    if (targetTabId === null) return null
    return snapshot.tabs.find((t) => t.tabId === targetTabId) ?? null
  }
}

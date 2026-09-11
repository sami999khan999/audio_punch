/**
 * Service worker — the coordinator.
 *
 * Owns the settings and the tab registry. The audio engine now lives in each
 * page's content script, so this worker's job is to resolve the right chain for
 * every page's origin and push it there, then relay the levels that come back
 * to whichever UI surfaces are open.
 *
 * The overlay and the dashboard hold no authoritative state: they send intents
 * and render the snapshot they get back, which is what keeps two open surfaces
 * (and the global strip inside each) consistent for free.
 */
import { chromePlatform } from '../platform/chrome.ts'
import {
  PORT_UI,
  type Broadcast,
  type ContentCommand,
  type ToBackground,
  type UiRequest,
  type UiResponse,
} from '../shared/messages.ts'
import { applyImport, makeExport, validateImport } from '../shared/migrate.ts'
import { originOf } from '../shared/origin.ts'
import type { Background, LevelReading, StateSnapshot } from '../shared/types.ts'
import { SettingsStore } from './settings.ts'
import { TabRegistry } from './tab-registry.ts'
import { resolveChain } from './resolve.ts'

const BACKGROUND_KEY = 'audio-punch:background'
const NO_BACKGROUND: Background = { kind: 'none', dataUrl: '', name: '', updatedAt: 0 }

const platform = chromePlatform
const store = new SettingsStore(platform)
const registry = new TabRegistry(platform)

const uiPorts = new Set<chrome.runtime.Port>()
const levels: Record<number, LevelReading> = {}
/** True while at least one UI is open, which is the only time metering runs. */
let metering = false

// ---------------------------------------------------------------- plumbing

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
  const tabs = registry.list()
  return {
    settings: store.current(),
    tabs,
    selfTabId,
    // Honest rather than hardcoded: the engine is only actually running where
    // a page has routed at least one element.
    engineReady: tabs.some((tab) => tab.hooked > 0),
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

async function readBackground(): Promise<Background> {
  return (await platform.storage.read<Background>(BACKGROUND_KEY)) ?? NO_BACKGROUND
}

// ------------------------------------------------------------- chain push

/**
 * Sends every page the chain resolved for its origin.
 *
 * Playback speed rides along separately: it is applied to the page's media
 * elements rather than in the audio graph, so the content script needs it as
 * its own instruction.
 */
const sentRates = new Map<number, number>()
/** Last chain sent to each tab, so a drag does not resend identical chains. */
const sentChains = new Map<number, string>()

/**
 * Coalesces the work a mutation triggers.
 *
 * Dragging a slider produces a patch per animation frame, and each one used to
 * fan out a tabs.query, a message to every tab and a full state broadcast.
 * Bursts collapse into one pass on a short timer, which still lands well
 * within a frame or two of the last movement.
 */
const SYNC_DEBOUNCE_MS = 40
let syncTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSync(): void {
  if (syncTimer) return
  syncTimer = setTimeout(() => {
    syncTimer = null
    void pushChains().then(publishState)
  }, SYNC_DEBOUNCE_MS)
}

async function pushChains(): Promise<void> {
  const settings = store.current()
  await registry.refresh()
  for (const tab of registry.list()) {
    const chain = resolveChain(settings, tab.origin)
    const signature = JSON.stringify(chain)
    if (sentChains.get(tab.tabId) !== signature) {
      sentChains.set(tab.tabId, signature)
      await platform.tabs.sendMessage(tab.tabId, {
        type: 'content:chain',
        chain,
      } satisfies ContentCommand)
    }
    await pushRate(tab.tabId, chain.speed.on && !chain.bypass ? chain.speed.rate : 1)
  }
}

async function pushChain(tabId: number, origin: string): Promise<void> {
  const chain = resolveChain(store.current(), origin)
  sentChains.set(tabId, JSON.stringify(chain))
  await platform.tabs.sendMessage(tabId, { type: 'content:chain', chain } satisfies ContentCommand)
  await pushRate(tabId, chain.speed.on && !chain.bypass ? chain.speed.rate : 1)
}

/** Only sent on a real change: pushChains runs on every knob movement. */
async function pushRate(tabId: number, rate: number): Promise<void> {
  if (sentRates.get(tabId) === rate) return
  sentRates.set(tabId, rate)
  await platform.tabs.sendMessage(tabId, { type: 'content:set-rate', rate } satisfies ContentCommand)
}

async function setMetering(enabled: boolean): Promise<void> {
  if (metering === enabled) return
  metering = enabled
  await registry.refresh()
  for (const tab of registry.list()) {
    await platform.tabs.sendMessage(tab.tabId, { type: 'content:meters', enabled } satisfies ContentCommand)
  }
}

// ------------------------------------------------------------- UI requests

async function handleUiRequest(request: UiRequest, senderTabId: number | null): Promise<UiResponse> {
  switch (request.type) {
    case 'ui:hello':
      return { ok: true, snapshot: await snapshot(senderTabId), background: await readBackground() }

    case 'ui:patch-chain':
      store.patchChain(request.target, request.patch)
      scheduleSync()
      return { ok: true }

    case 'ui:reset-chain':
      store.resetChain(request.target)
      await pushChains()
      return { ok: true }

    case 'ui:set-global-on':
      store.update((s) => {
        s.global.on = request.on
      })
      await pushChains()
      return { ok: true }

    case 'ui:set-ignore-global':
      store.setIgnoreGlobal(request.origin, request.value)
      await pushChains()
      return { ok: true }

    case 'ui:mute-all':
      store.update((s) => {
        s.muteAll = request.value ?? !s.muteAll
      })
      await pushChains()
      return { ok: true }

    case 'ui:bypass-all':
      store.update((s) => {
        s.bypassAll = request.value ?? !s.bypassAll
      })
      await pushChains()
      return { ok: true }

    case 'ui:save-template': {
      const template = store.saveTemplate(
        request.name,
        request.description,
        request.modules,
        request.source,
      )
      toast('info', `Saved "${template.name}".`)
      return { ok: true, template }
    }

    case 'ui:apply-template':
      try {
        store.applyTemplate(request.templateId, request.target)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      await pushChains()
      return { ok: true }

    case 'ui:remove-template':
      store.removeTemplate(request.target)
      await pushChains()
      return { ok: true }

    case 'ui:delete-template':
      store.deleteTemplate(request.templateId)
      await pushChains()
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
      await pushChains()
      return { ok: true }

    case 'ui:export':
      return { ok: true, settings: makeExport(store.current()).settings }

    case 'ui:import': {
      const result = validateImport(request.payload)
      if (!result.ok) return { ok: false, error: result.error }
      store.replaceAll(applyImport(store.current(), result.settings, request.mode))
      await store.flush()
      await pushChains()
      for (const warning of result.warnings) toast('warn', warning)
      toast('info', request.mode === 'replace' ? 'Settings replaced.' : 'Settings merged.')
      return { ok: true, snapshot: await snapshot(senderTabId) }
    }

    case 'ui:open-dashboard':
      await platform.openDashboard()
      return { ok: true }

    case 'ui:meters':
      await setMetering(request.enabled && store.current().ui.meters)
      return { ok: true }

    case 'ui:get-background':
      return { ok: true, background: await readBackground() }

    case 'ui:set-background': {
      // Kept out of Settings on purpose — a video would otherwise be
      // re-broadcast to every surface on every knob movement.
      await platform.storage.write(BACKGROUND_KEY, request.background)
      broadcast({ type: 'background', background: request.background })
      return { ok: true, background: request.background }
    }
  }
}

// ------------------------------------------------------------------- ports

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_UI) return
  uiPorts.add(port)
  const senderTabId = port.sender?.tab?.id ?? null

  port.onMessage.addListener((message: UiRequest & { requestId?: number }) => {
    void handleUiRequest(message, senderTabId)
      .then((response) => {
        if (message.requestId !== undefined) {
          port.postMessage({ requestId: message.requestId, response })
        }
        // Coalesced: a slider drag sends one of these per frame, and a full
        // snapshot broadcast per frame is pure waste.
        scheduleSync()
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
    if (uiPorts.size === 0) void setMetering(false)
  })

  void (async () => {
    await store.load()
    port.postMessage({ type: 'state', snapshot: await snapshot(senderTabId) })
    port.postMessage({ type: 'background', background: await readBackground() })
  })()
})

// -------------------------------------------------------- one-shot messages

chrome.runtime.onMessage.addListener((message: ToBackground, sender, sendResponse) => {
  const senderTabId = sender.tab?.id ?? null

  // Metering is high-frequency and one-way: relay it and get out. No state
  // publish, no chain resolve, no response.
  if (message?.type === 'content:level') {
    if (senderTabId !== null) {
      levels[senderTabId] = message.level
      broadcast({ type: 'meters', levels })
    }
    return false
  }

  if (message?.type === 'content:report') {
    if (senderTabId !== null) {
      registry.record(senderTabId, {
        hasMediaElements: message.hasMediaElements,
        count: message.count,
        hooked: message.hooked,
        silent: message.silent,
      })
      void publishState()
    }
    // Answer with the chain and the metering state, so a freshly loaded page
    // configures itself from one round trip instead of waiting for a push.
    void (async () => {
      await store.load()
      const origin = senderTabId === null ? '' : await registry.originFor(senderTabId)
      sendResponse({
        ok: true,
        chain: resolveChain(store.current(), origin),
        meters: metering,
      })
    })()
    return true
  }

  void store
    .load()
    .then(() => handleUiRequest(message as UiRequest, senderTabId))
    .then((response) => sendResponse(response))
    .catch((err) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    )
  return true
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
        await platform.tabs.sendMessage(tabId, { type: 'content:toggle-overlay' } satisfies ContentCommand)
        break

      case 'toggle-global':
        store.update((s) => {
          s.global.on = !s.global.on
        })
        toast('info', store.current().global.on ? 'Global chain on' : 'Global chain off')
        await pushChains()
        break

      case 'mute-all':
        store.update((s) => {
          s.muteAll = !s.muteAll
        })
        toast('info', store.current().muteAll ? 'All tabs muted' : 'Mute released')
        await pushChains()
        break

      case 'bypass-all':
        store.update((s) => {
          s.bypassAll = !s.bypassAll
        })
        toast('info', store.current().bypassAll ? 'Processing bypassed' : 'Processing re-engaged')
        await pushChains()
        break
    }
    await publishState()
  })()
})

chrome.action.onClicked.addListener((tab) => {
  void (async () => {
    await store.load()
    if (tab.id === undefined) return
    await platform.tabs.sendMessage(tab.id, { type: 'content:open-overlay' } satisfies ContentCommand)
  })()
})

// ------------------------------------------------------------ tab lifecycle

chrome.tabs.onRemoved.addListener((tabId) => {
  registry.forget(tabId)
  sentRates.delete(tabId)
  sentChains.delete(tabId)
  delete levels[tabId]
  void publishState()
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void (async () => {
    await store.load()
    if (changeInfo.url) {
      // A navigation replaces the page's media elements, so the rate must be
      // resent even when its value has not changed.
      registry.forget(tabId)
      sentRates.delete(tabId)
      sentChains.delete(tabId)
      const origin = originOf(changeInfo.url)
      if (origin) await pushChain(tabId, origin)
    }
    if (changeInfo.audible !== undefined || changeInfo.status === 'complete' || changeInfo.url) {
      await publishState()
    }
  })()
})

chrome.runtime.onStartup.addListener(() => void store.load())
chrome.runtime.onInstalled.addListener(() => void store.load())
void store.load()

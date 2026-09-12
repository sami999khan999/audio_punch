/**
 * Service worker — the coordinator.
 *
 * Owns the settings, resolves the volume each origin should play at, and
 * pushes it to that page's content script. The popup holds no authoritative
 * state: it sends intents and renders what it gets back.
 */
import {
  type Binding,
  type CommandName,
  type ContentCommand,
  type PopupBroadcast,
  type PopupRequest,
  type PopupResponse,
  type Scope,
  type ToBackground,
} from '../shared/messages.ts'
import { defaultAudio, readSettings } from '../shared/defaults.ts'
import { originOf } from '../shared/origin.ts'
import type { PopupState, Settings } from '../shared/types.ts'
import { nudge, readScope, resolveAudio, scopeFor, writeScope } from './resolve.ts'

const STORAGE_KEY = 'audio-punch:settings'
const WRITE_DEBOUNCE_MS = 250

let settings: Settings | null = null
let writeTimer: ReturnType<typeof setTimeout> | null = null
/** Tabs reporting media that cannot be boosted past 100%. */
const cappedTabs = new Set<number>()

async function load(): Promise<Settings> {
  if (settings) return settings
  const bag = await chrome.storage.local.get(STORAGE_KEY)
  settings = readSettings(bag[STORAGE_KEY])
  return settings
}

/** Debounced: holding the volume shortcut produces a write per keypress. */
function persist(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    void chrome.storage.local.set({ [STORAGE_KEY]: settings })
  }, WRITE_DEBOUNCE_MS)
}

async function send(tabId: number, command: ContentCommand): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, command)
  } catch {
    // No content script there (an unsupported page, or one still loading).
  }
}

/**
 * Pushes one tab the value its origin resolves to.
 *
 * `announce` asks the page to show the value on screen. Set for changes that
 * came from a shortcut, because in fullscreen there is no popup to read.
 */
async function pushTab(tabId: number, url: string | undefined, announce = false): Promise<void> {
  const origin = originOf(url)
  if (!origin || !settings) return
  await send(tabId, {
    type: 'content:apply',
    audio: resolveAudio(settings, origin),
    announce,
    global: settings.globalOn,
  })
}

/**
 * Pushes every tab. Used when the global switch moves, since that changes what
 * every page should be playing at once.
 */
async function pushAll(announce = false): Promise<void> {
  const tabs = await chrome.tabs.query({})
  const active = announce ? (await activeTab())?.id : undefined
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined ? undefined : pushTab(tab.id, tab.url, tab.id === active),
    ),
  )
}

/** Pushes every tab sharing one origin, so two YouTube tabs stay in step. */
async function pushOrigin(origin: string, announce = false): Promise<void> {
  const tabs = await chrome.tabs.query({})
  const active = announce ? (await activeTab())?.id : undefined
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined && originOf(tab.url) === origin)
      .map((tab) => pushTab(tab.id!, tab.url, tab.id === active)),
  )
}

/**
 * The tab the user is looking at.
 *
 * `currentWindow` is the right question from a popup — the popup belongs to the
 * browser window whose tab it is over. `lastFocusedWindow` is kept as a
 * fallback for the shortcut path, where there may be no popup at all and the
 * command can arrive with no window context.
 */
async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [inCurrent] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (inCurrent) return inCurrent
  const [inLast] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return inLast ?? null
}

async function popupState(): Promise<PopupState> {
  const current = await load()
  const tab = await activeTab()
  const origin = originOf(tab?.url)
  return {
    settings: current,
    origin,
    title: tab?.title ?? '',
    supported: origin !== '',
    boostCapped: tab?.id !== undefined && cappedTabs.has(tab.id),
  }
}

/** Applies a change to the right scope and pushes it where it belongs. */
async function apply(
  scope: Scope,
  origin: string,
  patch: Parameters<typeof writeScope>[3],
  announce = false,
): Promise<void> {
  const current = await load()
  writeScope(current, scope, origin, patch)
  persist()
  if (scope === 'global') await pushAll(announce)
  else await pushOrigin(origin, announce)
  await notifyPopup()
}

/**
 * Tells an open popup that something changed underneath it — a shortcut, or
 * another window. Without this the popup shows whatever it read when it opened.
 */
async function notifyPopup(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'popup:changed',
      state: await popupState(),
    } satisfies PopupBroadcast)
  } catch {
    // No popup open. That is the normal case.
  }
}

/**
 * Runs a shortcut. Shared by chrome.commands and by the in-page fallback the
 * content script uses in fullscreen, so both behave identically.
 */
async function runCommand(command: CommandName): Promise<void> {
  const current = await load()
  const tab = await activeTab()
  const origin = originOf(tab?.url)
  const scope = scopeFor(current)
  if (scope === 'site' && !origin) return

  switch (command) {
    case 'volume-up':
      await apply(scope, origin, nudge(readScope(current, scope, origin), 1), true)
      break
    case 'volume-down':
      await apply(scope, origin, nudge(readScope(current, scope, origin), -1), true)
      break
    case 'toggle-mute': {
      const now = readScope(current, scope, origin)
      await apply(scope, origin, { muted: !now.muted }, true)
      break
    }
    case 'toggle-global':
      current.globalOn = !current.globalOn
      persist()
      await pushAll(true)
      await notifyPopup()
      break
    case 'reset':
      await apply(scope, origin, defaultAudio(), true)
      break
  }
}

/** The shortcuts as the browser currently has them, defaults or rebound. */
async function bindings(): Promise<Binding[]> {
  const commands = await chrome.commands.getAll()
  return commands
    .filter((c): c is chrome.commands.Command & { name: string; shortcut: string } =>
      Boolean(c.name && c.shortcut),
    )
    .map((c) => ({ command: c.name as CommandName, shortcut: c.shortcut }))
}

async function handle(request: PopupRequest): Promise<PopupResponse> {
  const current = await load()
  const tab = await activeTab()
  const origin = originOf(tab?.url)

  switch (request.type) {
    case 'popup:hello':
      break

    case 'popup:set-global-on':
      current.globalOn = request.on
      persist()
      await pushAll()
      break

    case 'popup:set-volume':
      if (request.scope === 'site' && !origin) break
      await apply(request.scope, origin, { volume: request.volume })
      break

    case 'popup:nudge-volume': {
      if (request.scope === 'site' && !origin) break
      const next = nudge(readScope(current, request.scope, origin), request.steps)
      await apply(request.scope, origin, next)
      break
    }

    case 'popup:set-muted':
      if (request.scope === 'site' && !origin) break
      await apply(request.scope, origin, { muted: request.muted })
      break

    case 'popup:reset':
      if (request.scope === 'site' && !origin) break
      await apply(request.scope, origin, defaultAudio())
      break
  }

  return { ok: true, state: await popupState() }
}

// ------------------------------------------------------------------ wiring

chrome.runtime.onMessage.addListener((message: ToBackground, sender, sendResponse) => {
  // A page announcing itself gets its volume straight back, which is how a
  // freshly loaded or navigated tab configures itself.
  if (message?.type === 'content:ready') {
    const tabId = sender.tab?.id
    if (tabId !== undefined) {
      if (message.capped) cappedTabs.add(tabId)
      else cappedTabs.delete(tabId)
      void notifyPopup()
      void load().then(async () => {
        await pushTab(tabId, sender.tab?.url)
        // Hand the page the live bindings so its fullscreen fallback matches
        // whatever the user actually has configured.
        await send(tabId, { type: 'content:bindings', bindings: await bindings() })
      })
    }
    sendResponse({ ok: true })
    return false
  }

  if (message?.type === 'content:command') {
    void runCommand(message.command)
    sendResponse({ ok: true })
    return false
  }

  void handle(message as PopupRequest)
    .then(sendResponse)
    .catch((err) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    )
  return true // the response is asynchronous
})

/**
 * The browser allows an extension four shortcuts carrying a suggested key.
 * These are exactly the four this extension has.
 */
chrome.commands.onCommand.addListener((command) => {
  void runCommand(command as CommandName)
})

// A navigation replaces the page's media elements, so the value must be resent.
chrome.tabs.onRemoved.addListener((tabId) => cappedTabs.delete(tabId))

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) cappedTabs.delete(tabId)
  if (changeInfo.status !== 'complete' && !changeInfo.url) return
  void load().then(() => pushTab(tabId, changeInfo.url ?? tab.url))
})

chrome.runtime.onStartup.addListener(() => void load())
chrome.runtime.onInstalled.addListener(() => void load())
void load()

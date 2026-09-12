/**
 * Service worker — the coordinator.
 *
 * Owns the settings, resolves the volume each origin should play at, and
 * pushes it to that page's content script. The popup holds no authoritative
 * state: it sends intents and renders what it gets back.
 *
 * Everything here is arranged around one requirement: a keypress must be heard
 * immediately. The browser stops this worker whenever it is idle, so a shortcut
 * routinely arrives while it is still starting up, and several presses can be
 * delivered together the moment it is ready. Two rules follow, and the rest of
 * the file exists to keep them:
 *
 *  1. Read and write the settings without an `await` in between. Otherwise two
 *     commands delivered together both read the old value and the second
 *     silently undoes the first.
 *  2. Nothing the user can hear may wait on anything else. The tab being
 *     listened to is messaged first and directly; every other tab, the stored
 *     copy and the popup are caught up afterwards, off the critical path.
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
import type { AudioState, PopupState, Settings } from '../shared/types.ts'
import { nudge, readScope, resolveAudio, scopeFor, writeScope } from './resolve.ts'

const STORAGE_KEY = 'audio-punch:settings'
const WRITE_DEBOUNCE_MS = 250
/**
 * How long the active tab may be reused without asking again.
 *
 * Asking costs a round trip, and a burst of keypresses would otherwise pay it
 * once per press. The user cannot change tabs inside the window, and the
 * events below drop the cache the moment they actually do.
 */
const ACTIVE_TTL_MS = 700
/** Tabs other than the one in front are caught up together, once. */
const FANOUT_MS = 30
/** A tab that never answers must not hold a pending send open forever. */
const SEND_TIMEOUT_MS = 2000

let settings: Settings | null = null
let loading: Promise<Settings> | null = null
let writeTimer: ReturnType<typeof setTimeout> | null = null
/** Tabs reporting media that cannot be boosted past 100%. */
const cappedTabs = new Set<number>()

/**
 * Reads the settings, once.
 *
 * The memoised promise is the point. Without it, commands delivered together
 * on a cold start each begin their own read and each end up with a *separate*
 * settings object; they then edit different copies and only the last one
 * written survives. That is the "I pressed it five times and it moved once"
 * failure.
 */
function load(): Promise<Settings> {
  if (settings) return Promise.resolve(settings)
  loading ??= chrome.storage.local.get(STORAGE_KEY).then((bag) => {
    // Another caller may have finished first; that copy is the shared one.
    settings ??= readSettings(bag[STORAGE_KEY])
    loading = null
    return settings
  })
  return loading
}

/** Debounced: holding the volume shortcut produces a write per keypress. */
function persist(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    void chrome.storage.local.set({ [STORAGE_KEY]: settings })
  }, WRITE_DEBOUNCE_MS)
}

function send(tabId: number, command: ContentCommand): Promise<void> {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, command),
    new Promise((resolve) => setTimeout(resolve, SEND_TIMEOUT_MS)),
  ]).then(
    () => undefined,
    // No content script there (an unsupported page, or one still loading).
    () => undefined,
  )
}

/**
 * Pushes one tab the value its origin resolves to.
 *
 * `announce` asks the page to show the value on screen. Set for changes that
 * came from a shortcut, because in fullscreen there is no popup to read.
 */
function pushTab(
  tabId: number,
  url: string | undefined,
  announce = false,
  seq?: number,
): Promise<void> {
  const origin = originOf(url)
  if (!origin || !settings) return Promise.resolve()
  return send(tabId, {
    type: 'content:apply',
    audio: resolveAudio(settings, origin),
    announce,
    global: settings.globalOn,
    seq,
  })
}

// --------------------------------------------------------------- the fan-out

let fanTimer: ReturnType<typeof setTimeout> | null = null
let fanScope: Scope = 'site'
let fanOrigin = ''
let fanSkip: number | undefined

/**
 * Catches up every tab that is not the one in front.
 *
 * Deliberately coalesced and never awaited. Walking the tab list costs a round
 * trip and messaging a background tab can take as long as that tab's own main
 * thread needs, so doing it per keypress is what made a held-down shortcut feel
 * like it had seized up. Each pass sends the current value, so collapsing ten
 * passes into one loses nothing.
 */
function scheduleFanOut(scope: Scope, origin: string, skipTabId: number | undefined): void {
  fanScope = scope
  fanOrigin = origin
  fanSkip = skipTabId
  if (fanTimer) return
  fanTimer = setTimeout(() => {
    fanTimer = null
    void fanOut(fanScope, fanOrigin, fanSkip)
  }, FANOUT_MS)
}

async function fanOut(scope: Scope, origin: string, skipTabId: number | undefined): Promise<void> {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (tab.id === undefined || tab.id === skipTabId) continue
    // Global moves every tab; a site change moves only that site's tabs, so two
    // windows on the same site stay in step.
    if (scope === 'site' && originOf(tab.url) !== origin) continue
    void pushTab(tab.id, tab.url)
  }
}

// ------------------------------------------------------------ the active tab

let activeCache: { tab: chrome.tabs.Tab | null; at: number } | null = null

function forgetActive(): void {
  activeCache = null
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
  if (activeCache && Date.now() - activeCache.at < ACTIVE_TTL_MS) return activeCache.tab
  const [inCurrent] = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = inCurrent ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] ?? null
  activeCache = { tab, at: Date.now() }
  return tab
}

// ----------------------------------------------------------------- the popup

let notifyTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Tells an open popup that something changed underneath it — a shortcut, or
 * another window. Without this the popup shows whatever it read when it opened.
 *
 * Coalesced and never awaited: the popup is a picture of the state, so the only
 * one that matters is the last, and redrawing it is not worth delaying audio.
 */
function scheduleNotify(): void {
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    void notifyPopup()
  }, FANOUT_MS)
}

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

// ------------------------------------------------------------------- applying

/**
 * Writes a change and gets it heard.
 *
 * The write is synchronous on purpose — see the note at the top of the file.
 * The tab in front is messaged directly and first; storage, the other tabs and
 * the popup all follow behind it.
 */
function commit(
  current: Settings,
  scope: Scope,
  origin: string,
  patch: Partial<AudioState>,
  front: chrome.tabs.Tab | null,
  announce = false,
  echo?: Echo,
): void {
  writeScope(current, scope, origin, patch)
  persist()

  if (front?.id !== undefined && originOf(front.url) !== '') {
    // The page that caught the keypress gets its own press number back, so it
    // can tell this push apart from one answering an earlier press.
    void pushTab(front.id, front.url, announce, echo?.tabId === front.id ? echo.seq : undefined)
  }
  scheduleFanOut(scope, origin, front?.id)
  scheduleNotify()
}

/**
 * Runs a shortcut. Shared by chrome.commands and by the in-page fallback the
 * content script uses in fullscreen, so both behave identically.
 */
/** Identifies the press a push is answering, for the page that caught it. */
interface Echo {
  tabId: number
  seq: number
}

async function runCommand(command: CommandName, echo?: Echo): Promise<void> {
  const current = await load()
  const tab = await activeTab()
  const origin = originOf(tab?.url)
  const scope = scopeFor(current)
  if (scope === 'site' && !origin) return

  // No `await` past this point: the read and the write have to land in one
  // turn or a second command delivered alongside this one will undo it.
  switch (command) {
    case 'volume-up':
      commit(current, scope, origin, nudge(readScope(current, scope, origin), 1), tab, true, echo)
      break
    case 'volume-down':
      commit(current, scope, origin, nudge(readScope(current, scope, origin), -1), tab, true, echo)
      break
    case 'toggle-mute':
      commit(current, scope, origin, { muted: !readScope(current, scope, origin).muted }, tab, true, echo)
      break
    case 'toggle-global':
      current.globalOn = !current.globalOn
      persist()
      // Every tab's value changes at once, so nothing can be skipped — but the
      // one in front still goes first.
      if (tab?.id !== undefined) {
        void pushTab(tab.id, tab.url, true, echo?.tabId === tab.id ? echo.seq : undefined)
      }
      scheduleFanOut('global', origin, tab?.id)
      scheduleNotify()
      break
    case 'reset':
      commit(current, scope, origin, defaultAudio(), tab, true, echo)
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
      if (tab?.id !== undefined) void pushTab(tab.id, tab.url)
      scheduleFanOut('global', origin, tab?.id)
      break

    case 'popup:set-volume':
      if (request.scope === 'site' && !origin) break
      commit(current, request.scope, origin, { volume: request.volume }, tab)
      break

    case 'popup:nudge-volume':
      if (request.scope === 'site' && !origin) break
      commit(
        current,
        request.scope,
        origin,
        nudge(readScope(current, request.scope, origin), request.steps),
        tab,
      )
      break

    case 'popup:set-muted':
      if (request.scope === 'site' && !origin) break
      commit(current, request.scope, origin, { muted: request.muted }, tab)
      break

    case 'popup:reset':
      if (request.scope === 'site' && !origin) break
      commit(current, request.scope, origin, defaultAudio(), tab)
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
      scheduleNotify()
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
    // The page has already moved its own audio optimistically; this settles the
    // stored value and catches up every other tab.
    const tabId = sender.tab?.id
    void runCommand(
      message.command,
      tabId === undefined ? undefined : { tabId, seq: message.seq },
    )
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

// The active tab is cached for a moment; anything that could move it drops it.
chrome.tabs.onActivated.addListener(forgetActive)
chrome.tabs.onRemoved.addListener((tabId) => {
  cappedTabs.delete(tabId)
  forgetActive()
})
chrome.windows.onFocusChanged.addListener(forgetActive)

// A navigation replaces the page's media elements, so the value must be resent.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    cappedTabs.delete(tabId)
    forgetActive()
  }
  if (changeInfo.title) forgetActive()
  if (changeInfo.status !== 'complete' && !changeInfo.url) return
  void load().then(() => pushTab(tabId, changeInfo.url ?? tab.url))
})

chrome.runtime.onStartup.addListener(() => void load())
chrome.runtime.onInstalled.addListener(() => void load())
void load()

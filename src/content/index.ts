/**
 * Content script entry point.
 *
 * Runs on every http(s) page and owns two things: the audio engine for this
 * page, and the mixer overlay. The engine starts only once a media element
 * actually exists, and the overlay is built only when first opened, so a page
 * that never plays anything pays almost nothing.
 */
import type { ChainState } from '../shared/types.ts'
import type { ContentCommand, ContentLevel, ContentReport } from '../shared/messages.ts'
import { UiStore } from '../ui/core/store.ts'
import { ContentEngine } from './engine.ts'
import { createMediaController } from './media-control.ts'
import { createKeymap } from './keymap.ts'
import { createOverlay, type OverlayHandle } from './overlay.ts'

const METER_INTERVAL_MS = 1000 / 24

// Frames would each build their own overlay and their own engine; only the top
// document gets them. Media inside an iframe is that frame's own script's job.
if (window.top === window.self) {
  start()
}

function start(): void {
  // Every piece of mutable state is declared before anything that could read
  // it. The engine and the media controller both call back into `report`, and
  // `report` touches most of this — a `let` declared further down would be in
  // its temporal dead zone at that moment and throw, taking the whole content
  // script (and so the message listener) with it.
  const store = new UiStore()
  let overlay: OverlayHandle | null = null
  let chain: ChainState | null = null
  let meterTimer: ReturnType<typeof setInterval> | null = null
  /** The last report we sent, so identical ones are not resent. */
  let lastReport = ''
  /** Last chain we handed the engine, to skip redundant re-applies. */
  let lastChain = ''

  const engine = new ContentEngine(() => report())
  const media = createMediaController(engine, () => report())

  /**
   * Tells the worker what this page has, and takes back the chain it should be
   * running. One round trip configures a freshly loaded page.
   *
   * Only sent when the page's media situation actually changes — this used to
   * ride the metering timer, which meant a chain resolve, a reply and a full
   * re-apply of every parameter twenty-four times a second.
   */
  function report(): void {
    const status = engine.status()
    const message: ContentReport = {
      type: 'content:report',
      hasMediaElements: media.hasMedia(),
      count: media.count(),
      hooked: status.hooked,
      silent: status.silent,
    }
    const signature = JSON.stringify(message)
    if (signature === lastReport) return
    lastReport = signature

    void chrome.runtime
      .sendMessage(message)
      .then((reply: { chain?: ChainState; meters?: boolean } | undefined) => {
        if (reply?.chain) applyChain(reply.chain)
        if (reply?.meters !== undefined) setMetering(reply.meters)
      })
      .catch(() => {
        // The worker is asleep or reloading. Clear the dedupe key so the next
        // change retries — otherwise a failed first report would be the only
        // one this page ever sends.
        lastReport = ''
      })
  }

  function applyChain(next: ChainState): void {
    const signature = JSON.stringify(next)
    if (signature === lastChain) return
    lastChain = signature
    chain = next
    engine.apply(next)
  }

  function setMetering(enabled: boolean): void {
    if (enabled && !meterTimer) {
      meterTimer = setInterval(() => {
        const level = engine.readLevel()
        // Fire and forget: no reply, no chain round trip, no state publish.
        if (level) {
          void chrome.runtime
            .sendMessage({ type: 'content:level', level } satisfies ContentLevel)
            .catch(() => undefined)
        }
      }, METER_INTERVAL_MS)
    } else if (!enabled && meterTimer) {
      clearInterval(meterTimer)
      meterTimer = null
    }
  }

  /**
   * The overlay is built on first use. Doing it eagerly would mean every page
   * in the browser carrying a shadow root and a stylesheet it will never show.
   */
  function ensureOverlay(): OverlayHandle {
    if (overlay) return overlay
    store.connect()
    overlay = createOverlay(store)
    store.subscribe((state) => overlay?.update(state))
    installKeyHandler(overlay)
    media.scan()
    return overlay
  }

  function installKeyHandler(handle: OverlayHandle): void {
    const dispatch = createKeymap({
      actions: handle.mixer.actions,
      keymap: () => store.get().snapshot.settings.keymap,
      onHelp: () => handle.toggleHelp(),
      onClose: () => handle.close(),
    })

    // Capture phase, and only while the overlay is open: the page never sees
    // these keys, and we never swallow keys when the mixer is closed.
    window.addEventListener(
      'keydown',
      (event) => {
        if (!handle.isOpen()) return
        const target = event.composedPath()[0]
        if (
          target instanceof HTMLElement &&
          (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        ) {
          if (event.key !== 'Escape') return
        }
        if (dispatch(event)) {
          event.preventDefault()
          event.stopPropagation()
        }
      },
      { capture: true },
    )
  }

  chrome.runtime.onMessage.addListener((message: ContentCommand, _sender, sendResponse) => {
    switch (message.type) {
      case 'content:toggle-overlay':
        ensureOverlay().toggle()
        break
      case 'content:open-overlay':
        ensureOverlay().open()
        break
      case 'content:close-overlay':
        overlay?.close()
        break
      case 'content:chain':
        applyChain(message.chain)
        break
      case 'content:set-rate':
        media.setRate(message.rate)
        break
      case 'content:meters':
        setMetering(message.enabled)
        break
      case 'content:probe-media':
        media.scan()
        break
    }
    const status = engine.status()
    sendResponse({
      ok: true,
      hasMedia: media.hasMedia(),
      count: media.count(),
      hooked: status.hooked,
      chain: chain !== null,
    })
    return false
  })

  // Last: everything above is initialised, so the first scan can safely report.
  media.scan()

  window.addEventListener('pagehide', () => media.destroy(), { once: true })
}

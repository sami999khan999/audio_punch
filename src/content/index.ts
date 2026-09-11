/**
 * Content script entry point.
 *
 * Runs on every http(s) page. It stays inert — no overlay in the DOM, no
 * listeners beyond a message port — until the mixer is actually opened, so the
 * cost to a page that never uses Audio Punch is close to nothing.
 */
import type { ContentCommand, ContentReport } from '../shared/messages.ts'
import { UiStore } from '../ui/core/store.ts'
import { createMediaController } from './media-control.ts'
import { createKeymap } from './keymap.ts'
import { createOverlay, type OverlayHandle } from './overlay.ts'

// Frames would each build their own overlay; only the top document gets one.
if (window.top === window.self) {
  start()
}

function start(): void {
  const store = new UiStore()
  let overlay: OverlayHandle | null = null

  const media = createMediaController((hasMediaElements, count) => {
    const report: ContentReport = { type: 'content:media-report', hasMediaElements, count }
    void chrome.runtime.sendMessage(report).catch(() => undefined)
  })

  /**
   * The overlay is built on first use. Doing it at document_idle would mean
   * every page in the browser carrying a shadow root and a stylesheet it will
   * probably never show.
   */
  function ensureOverlay(): OverlayHandle {
    if (overlay) return overlay
    store.connect()
    overlay = createOverlay(store)
    store.subscribe((state) => overlay?.update(state))
    installKeyHandler(overlay)
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
        // Typing into the template-name field must reach the field.
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
      case 'content:set-rate':
        media.setRate(message.rate)
        break
      case 'content:probe-media':
        break
    }
    sendResponse({ ok: true, hasMedia: media.hasMedia(), count: media.count() })
    return false
  })

  // Speed must not outlive the page's use of it.
  window.addEventListener('pagehide', () => media.destroy(), { once: true })
}

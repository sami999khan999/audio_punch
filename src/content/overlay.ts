/**
 * The mixer overlay.
 *
 * Rendered into a closed shadow root so neither the page's CSS nor its scripts
 * can reach it, and nothing we do leaks out.
 *
 * Two behaviours here exist because of real defects in the previous version:
 *
 * 1. **A closed overlay must not hit-test.** The old panel left an invisible
 *    fixed element over the top of the page, which swallowed clicks on
 *    everything beneath it — including video players' fullscreen buttons. The
 *    host is now `display: none` when closed, and `pointer-events: none` until
 *    opened.
 * 2. **Fullscreen puts one element in the top layer**, above anything a
 *    z-index can reach, so an overlay parented to <html> simply vanishes when a
 *    video goes fullscreen. The host follows the fullscreen element instead.
 */
import { STYLESHEET } from '../ui/core/tokens.ts'
import { el, onDrag } from '../ui/core/dom.ts'
import type { UiState, UiStore } from '../ui/core/store.ts'
import { createMixer, type MixerHandle } from '../ui/views/mixer.ts'
import { ACTION_CATALOG, formatAccelerator } from './keymap.ts'

const HOST_ID = 'audio-punch-overlay-host'
const MIN_HEIGHT = 320
/** Panel heights below this fraction of the viewport are snapped back to full. */
const FILL_SENTINEL = 0

export interface OverlayHandle {
  open(): void
  close(): void
  toggle(): void
  toggleHelp(): void
  isOpen(): boolean
  update(state: UiState): void
  mixer: MixerHandle
  destroy(): void
}

export function createOverlay(store: UiStore): OverlayHandle {
  const host = document.createElement('div')
  host.id = HOST_ID
  // `display: none` rather than just transparent: a hidden overlay must be
  // invisible to hit-testing, not merely to the eye.
  host.style.cssText = 'all: initial; display: none;'
  host.setAttribute('aria-hidden', 'true')

  const shadow = host.attachShadow({ mode: 'closed' })
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(STYLESHEET)
  shadow.adoptedStyleSheets = [sheet]

  let open = false
  let height = store.get().snapshot.settings.ui.overlayHeight

  const backdropMedia = el('div')
  const backdrop = el('div', { class: 'ap-backdrop' }, [
    backdropMedia,
    el('div', { class: 'ap-backdrop-scrim' }),
  ])

  const helpSheet = el('div', { class: 'ap-help ap-scroll', hidden: true })
  const toastLayer = el('div', { class: 'ap-toasts' })

  const mixer = createMixer({
    store,
    showClose: true,
    onHelp: () => toggleHelp(),
    onClose: () => api.close(),
  })

  const grip = el(
    'div',
    {
      class: 'ap-grip',
      role: 'separator',
      'aria-label': 'Drag to resize the mixer',
      tabindex: '0',
      title: 'Drag to resize — double-click to fill',
    },
    [el('div', { class: 'ap-grip-bar' })],
  )

  const panel = el('div', { class: 'ap-panel' }, [mixer.el, grip])

  const overlay = el(
    'div',
    { class: 'ap-root ap-overlay', 'data-open': 'false' },
    [backdrop, panel, helpSheet, toastLayer],
  )
  // Clicking the backdrop outside the panel dismisses, as a full-screen
  // surface should.
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop || event.target === backdrop.firstElementChild) api.close()
  })

  shadow.append(overlay)
  overlay.tabIndex = -1

  // ── sizing ─────────────────────────────────────────────────────────────

  function applyHeight(next: number): void {
    height = next
    if (next === FILL_SENTINEL) {
      overlay.setAttribute('data-sized', 'false')
      panel.style.height = ''
      return
    }
    const max = window.innerHeight
    height = Math.round(Math.min(max, Math.max(MIN_HEIGHT, next)))
    overlay.setAttribute('data-sized', 'true')
    panel.style.height = `${height}px`
  }
  applyHeight(height)

  let dragStart = 0
  onDrag(grip, {
    onStart: () => {
      dragStart = panel.getBoundingClientRect().height
    },
    onMove: (delta) => applyHeight(dragStart + delta.y),
    onEnd: () => {
      // Dragged to (near) full height means "fill", so the panel keeps
      // following the window instead of freezing at today's pixel count.
      const next = height >= window.innerHeight - 24 ? FILL_SENTINEL : height
      applyHeight(next)
      void store.send({ type: 'ui:set-ui-prefs', patch: { overlayHeight: next } })
    },
  })
  grip.addEventListener('dblclick', () => {
    applyHeight(FILL_SENTINEL)
    void store.send({ type: 'ui:set-ui-prefs', patch: { overlayHeight: FILL_SENTINEL } })
  })
  grip.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 16 : 48
    const current = panel.getBoundingClientRect().height
    if (event.key === 'ArrowDown') applyHeight(current + step)
    else if (event.key === 'ArrowUp') applyHeight(current - step)
    else if (event.key === 'Home') applyHeight(FILL_SENTINEL)
    else return
    event.preventDefault()
    void store.send({ type: 'ui:set-ui-prefs', patch: { overlayHeight: height } })
  })

  // ── fullscreen ─────────────────────────────────────────────────────────

  /**
   * Re-parents the host into whatever is currently fullscreen. Anything outside
   * the fullscreen element is not rendered at all, so this is the only way the
   * mixer survives a fullscreen video.
   */
  function followFullscreen(): void {
    const target = document.fullscreenElement ?? document.documentElement
    if (host.parentElement !== target) target.append(host)
  }
  document.addEventListener('fullscreenchange', followFullscreen)

  // ── backdrop media ─────────────────────────────────────────────────────

  let renderedBackground = ''

  function renderBackdrop(state: UiState): void {
    const { background } = state
    const key = `${background.kind}:${background.updatedAt}`
    if (key !== renderedBackground) {
      renderedBackground = key
      if (background.kind === 'image') {
        backdropMedia.replaceChildren(
          el('img', { class: 'ap-backdrop-media', src: background.dataUrl, alt: '' }),
        )
      } else if (background.kind === 'video') {
        const video = el('video', {
          class: 'ap-backdrop-media',
          src: background.dataUrl,
          autoplay: true,
          loop: true,
          muted: true,
          playsinline: true,
        }) as HTMLVideoElement
        // Muted is set as a property too: the attribute alone is ignored by
        // autoplay policy in some builds.
        video.muted = true
        backdropMedia.replaceChildren(video)
      } else {
        backdropMedia.replaceChildren()
      }
    }
    const { ui } = state.snapshot.settings
    overlay.style.setProperty('--ap-bg-dim', String(background.kind === 'none' ? 0.82 : ui.backgroundDim))
    overlay.style.setProperty('--ap-bg-blur', `${ui.backgroundBlur}px`)
  }

  // ── help ───────────────────────────────────────────────────────────────

  function renderHelp(keymap: Record<string, string[]>): void {
    const groups = new Map<string, HTMLElement>()
    helpSheet.replaceChildren()
    for (const action of ACTION_CATALOG) {
      let group = groups.get(action.group)
      if (!group) {
        group = el('div', { class: 'ap-help-group' }, [
          el('div', { class: 'ap-label', text: action.group }),
        ])
        groups.set(action.group, group)
        helpSheet.append(group)
      }
      const accelerators = keymap[action.id] ?? []
      group.append(
        el('div', { class: 'ap-help-row' }, [
          el('span', { text: action.label }),
          el('span', {
            class: 'ap-kbd',
            text: accelerators.length > 0 ? formatAccelerator(accelerators[0]!) : '—',
          }),
        ]),
      )
    }
    helpSheet.append(
      el('div', { class: 'ap-help-group' }, [
        el('div', { class: 'ap-label', text: 'Browser shortcuts' }),
        ...[
          ['Show / hide the mixer', 'Alt + Shift + A'],
          ['Global chain on / off', 'Alt + Shift + G'],
          ['Mute every tab', 'Alt + Shift + M'],
          ['Bypass all processing', 'Alt + Shift + B'],
        ].map(([label, keys]) =>
          el('div', { class: 'ap-help-row' }, [
            el('span', { text: label! }),
            el('span', { class: 'ap-kbd', text: keys! }),
          ]),
        ),
        el('div', {
          class: 'ap-note',
          style: 'padding-top:8px',
          text: 'Rebind these four at chrome://extensions/shortcuts.',
        }),
      ]),
    )
  }

  function toggleHelp(force?: boolean): void {
    const next = force ?? helpSheet.hidden
    helpSheet.hidden = !next
    if (next) renderHelp(store.get().snapshot.settings.keymap)
  }

  // ── toasts ─────────────────────────────────────────────────────────────

  let renderedToasts = ''
  function renderToasts(state: UiState): void {
    const signature = state.toasts.map((t) => t.id).join(',')
    if (signature === renderedToasts) return
    renderedToasts = signature
    toastLayer.replaceChildren(
      ...state.toasts.map((toast) =>
        el('div', {
          class: 'ap-toast',
          'data-kind': toast.kind,
          role: 'status',
          text: toast.text,
          title: 'Dismiss',
          onclick: () => store.dismissToast(toast.id),
        }),
      ),
    )
  }

  // ── api ────────────────────────────────────────────────────────────────

  const api: OverlayHandle = {
    mixer,
    toggleHelp: () => toggleHelp(),
    open() {
      followFullscreen()
      host.style.display = 'block'
      open = true
      host.setAttribute('aria-hidden', 'false')
      // Two frames: one to apply `display`, one so the transition runs.
      requestAnimationFrame(() => {
        overlay.setAttribute('data-open', 'true')
        overlay.focus({ preventScroll: true })
      })
      store.set({ open: true })
      void store.send({ type: 'ui:meters', enabled: true })
    },
    close() {
      open = false
      overlay.setAttribute('data-open', 'false')
      host.setAttribute('aria-hidden', 'true')
      toggleHelp(false)
      store.set({ open: false })
      void store.send({ type: 'ui:meters', enabled: false })
      // Wait out the fade before removing from the layout, so the exit is
      // visible but the page is clickable the instant it finishes.
      setTimeout(() => {
        if (!open) host.style.display = 'none'
      }, 240)
    },
    toggle() {
      if (open) api.close()
      else api.open()
    },
    isOpen: () => open,
    update(state) {
      mixer.update(state)
      renderToasts(state)
      renderBackdrop(state)
      applyHeight(state.snapshot.settings.ui.overlayHeight)
      overlay.setAttribute('data-reduce-motion', String(state.snapshot.settings.ui.reduceMotion))
      overlay.style.setProperty('--ap-accent', state.snapshot.settings.ui.accent)
      if (!helpSheet.hidden) renderHelp(state.snapshot.settings.keymap)
    },
    destroy() {
      document.removeEventListener('fullscreenchange', followFullscreen)
      host.remove()
    },
  }

  document.documentElement.append(host)
  return api
}

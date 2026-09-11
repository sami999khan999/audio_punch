/**
 * The slide-down mixer overlay.
 *
 * Rendered into a closed shadow root so that neither the page's CSS nor its
 * scripts can reach the panel, and nothing we do leaks back out. The host
 * element is fixed to the top edge and translated out of view when closed, so
 * opening is a single transform — cheap enough to stay smooth on a heavy page.
 */
import { STYLESHEET } from '../ui/core/tokens.ts'
import { el, onDrag } from '../ui/core/dom.ts'
import type { UiState, UiStore } from '../ui/core/store.ts'
import { createMixer, type MixerHandle } from '../ui/views/mixer.ts'
import { ACTION_CATALOG, formatAccelerator } from './keymap.ts'

const HOST_ID = 'audio-punch-overlay-host'
const MIN_HEIGHT = 260
const MAX_HEIGHT = 900

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
  // The host itself must not participate in the page's layout at all.
  host.style.cssText = 'all: initial; position: fixed; inset: 0 0 auto 0; z-index: 2147483647;'
  host.setAttribute('aria-hidden', 'true')

  const shadow = host.attachShadow({ mode: 'closed' })
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(STYLESHEET)
  shadow.adoptedStyleSheets = [sheet]

  let open = false
  let height = store.get().snapshot.settings.ui.overlayHeight

  const helpSheet = el('div', { class: 'ap-help', hidden: true })
  const toastLayer = el('div', { class: 'ap-toasts' })

  const mixer = createMixer({
    store,
    showClose: true,
    onHelp: () => toggleHelp(),
    onClose: () => api.close(),
  })

  const gripBar = el('div', { class: 'ap-grip-bar' })
  const grip = el(
    'div',
    {
      class: 'ap-grip',
      role: 'separator',
      'aria-label': 'Drag to resize the mixer',
      tabindex: '0',
      title: 'Drag to resize',
    },
    [gripBar],
  )

  const shell = el('div', { class: 'ap-root ap-shell', 'data-open': 'false' }, [
    mixer.el,
    grip,
    helpSheet,
    toastLayer,
  ])
  shadow.append(shell)

  function applyHeight(next: number): void {
    height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, next)))
    shell.style.height = `${height}px`
  }
  applyHeight(height)

  let dragStartHeight = height
  onDrag(grip, {
    onStart: () => {
      dragStartHeight = height
    },
    onMove: (delta) => applyHeight(dragStartHeight + delta.y),
    onEnd: () => {
      void store.send({ type: 'ui:set-ui-prefs', patch: { overlayHeight: height } })
    },
  })
  grip.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 8 : 32
    if (event.key === 'ArrowDown') applyHeight(height + step)
    else if (event.key === 'ArrowUp') applyHeight(height - step)
    else return
    event.preventDefault()
    void store.send({ type: 'ui:set-ui-prefs', patch: { overlayHeight: height } })
  })

  // ---------------------------------------------------------------- help

  function renderHelp(keymap: Record<string, string[]>): void {
    const groups = new Map<string, HTMLElement>()
    helpSheet.replaceChildren()
    for (const action of ACTION_CATALOG) {
      let group = groups.get(action.group)
      if (!group) {
        group = el('div', { class: 'ap-help-group' }, [
          el('div', { class: 'ap-legend', text: action.group }),
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
        el('div', { class: 'ap-legend', text: 'Browser shortcuts' }),
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
          class: 'ap-strip-sub',
          style: 'white-space:normal;padding-top:6px',
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

  // -------------------------------------------------------------- toasts

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

  // ----------------------------------------------------------------- api

  const api: OverlayHandle = {
    mixer,
    toggleHelp: () => toggleHelp(),
    open() {
      if (!host.isConnected) document.documentElement.append(host)
      open = true
      host.setAttribute('aria-hidden', 'false')
      shell.setAttribute('data-open', 'true')
      store.set({ open: true })
      void store.send({ type: 'ui:meters', enabled: true })
      // Focus lands on the panel so the keymap is live immediately, which is
      // the whole point of opening it from a shortcut.
      requestAnimationFrame(() => shell.focus({ preventScroll: true }))
    },
    close() {
      open = false
      shell.setAttribute('data-open', 'false')
      host.setAttribute('aria-hidden', 'true')
      toggleHelp(false)
      store.set({ open: false })
      void store.send({ type: 'ui:meters', enabled: false })
    },
    toggle() {
      if (open) api.close()
      else api.open()
    },
    isOpen: () => open,
    update(state) {
      mixer.update(state)
      renderToasts(state)
      applyHeight(state.snapshot.settings.ui.overlayHeight)
      shell.setAttribute('data-reduce-motion', String(state.snapshot.settings.ui.reduceMotion))
      shell.style.setProperty('--ap-lit', state.snapshot.settings.ui.accent)
      if (!helpSheet.hidden) renderHelp(state.snapshot.settings.keymap)
    },
    destroy() {
      host.remove()
    },
  }

  shell.tabIndex = -1
  return api
}

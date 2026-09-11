/**
 * The full mixing desk.
 *
 * An extension page rather than a popup: it survives losing focus, it can
 * download a file, and it is reachable on pages where a content script cannot
 * run — which is the whole reason it exists alongside the overlay.
 */
import { STYLESHEET } from '../ui/core/tokens.ts'
import { el } from '../ui/core/dom.ts'
import { UiStore, type UiState } from '../ui/core/store.ts'
import { createMixer } from '../ui/views/mixer.ts'
import { createTemplatesView } from '../ui/views/templates.ts'
import { createKeymapEditor } from '../ui/views/keymap-editor.ts'
import { createSettingsView } from '../ui/views/io.ts'
import type { Background } from '../shared/types.ts'

type PaneId = 'mixer' | 'templates' | 'shortcuts' | 'settings'

const PANES: Array<{ id: PaneId; label: string }> = [
  { id: 'mixer', label: 'Mixer' },
  { id: 'templates', label: 'Templates' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'settings', label: 'Settings' },
]

function mount(): void {
  const style = document.createElement('style')
  style.textContent = STYLESHEET
  document.head.append(style)
  document.title = 'Audio Punch'

  const store = new UiStore()
  store.connect()

  let pane: PaneId = (location.hash.slice(1) as PaneId) || 'mixer'
  if (!PANES.some((p) => p.id === pane)) pane = 'mixer'

  const mixer = createMixer({
    store,
    showClose: false,
    showWordmark: false,
    onHelp: () => select('shortcuts'),
    onClose: () => undefined,
  })
  const templates = createTemplatesView(store)
  const shortcuts = createKeymapEditor(store)
  const settings = createSettingsView(store)

  // The mixer brings its own bar and a full-height body, so it gets a framed
  // shell of its own rather than sitting in the page's content column.
  const mixerShell = el(
    'div',
    {
      class: 'ap-glass',
      style:
        'display:flex;flex-direction:column;height:min(900px,82vh);overflow:hidden;position:relative',
    },
    [mixer.el],
  )

  const content = el('div', { style: 'flex:1 1 auto;min-height:0' })
  const toastLayer = el('div', { class: 'ap-toasts', style: 'position:fixed' })

  // The dashboard wears the same backdrop as the overlay, so the two surfaces
  // read as one product rather than two.
  const backdropMedia = el('div')
  const backdrop = el('div', { class: 'ap-backdrop' }, [
    backdropMedia,
    el('div', { class: 'ap-backdrop-scrim' }),
  ])
  let renderedBackground = ''

  function renderBackdrop(background: Background, dim: number, blur: number): void {
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
          playsinline: true,
        }) as HTMLVideoElement
        video.muted = true
        backdropMedia.replaceChildren(video)
      } else {
        backdropMedia.replaceChildren()
      }
    }
    root.style.setProperty('--ap-bg-dim', String(background.kind === 'none' ? 0.86 : dim))
    root.style.setProperty('--ap-bg-blur', `${blur}px`)
  }

  // `ap-panes` distinguishes these from the rack's module-group tabs, which
  // share the ap-tab styling.
  const tabs = el(
    'div',
    { class: 'ap-tabs ap-panes', role: 'tablist' },
    PANES.map((entry) =>
      el('button', {
        class: 'ap-tab',
        type: 'button',
        role: 'tab',
        text: entry.label,
        'data-pane': entry.id,
        'data-on': String(entry.id === pane),
        'aria-selected': String(entry.id === pane),
        onclick: () => select(entry.id),
      }),
    ),
  )

  const connection = el('div', { class: 'ap-label' })

  const root = el('div', { class: 'ap-root ap-page' }, [
    backdrop,
    el('div', { class: 'ap-page-inner' }, [
      el('div', { class: 'ap-page-head' }, [
        el('div', { class: 'ap-brand' }, [
          el('b', { text: 'Audio' }),
          el('span', { text: 'Punch' }),
        ]),
        tabs,
        el('div', { class: 'ap-spacer' }),
        connection,
      ]),
      content,
    ]),
    toastLayer,
  ])

  function select(next: PaneId): void {
    pane = next
    history.replaceState(null, '', `#${next}`)
    for (const tab of tabs.children) {
      const on = tab.getAttribute('data-pane') === next
      tab.setAttribute('data-on', String(on))
      tab.setAttribute('aria-selected', String(on))
    }
    render(store.get())
  }

  let renderedPane: PaneId | null = null

  function render(state: UiState): void {
    if (renderedPane !== pane) {
      renderedPane = pane
      const view =
        pane === 'mixer'
          ? mixerShell
          : pane === 'templates'
            ? templates.el
            : pane === 'shortcuts'
              ? shortcuts.el
              : settings.el
      content.replaceChildren(view)
    }

    // Every pane stays subscribed: switching back should not show stale values
    // for a moment while the next broadcast arrives.
    mixer.update(state)
    templates.update(state)
    shortcuts.update(state)
    settings.update(state)

    const processing = state.snapshot.tabs.filter((tab) => tab.hooked > 0).length
    connection.textContent = !state.connected
      ? 'Reconnecting…'
      : processing === 0
        ? 'No audio routed'
        : `Processing ${processing} tab${processing === 1 ? '' : 's'}`

    root.style.setProperty('--ap-accent', state.snapshot.settings.ui.accent)
    root.setAttribute('data-reduce-motion', String(state.snapshot.settings.ui.reduceMotion))
    renderBackdrop(
      state.background,
      state.snapshot.settings.ui.backgroundDim,
      state.snapshot.settings.ui.backgroundBlur,
    )

    toastLayer.replaceChildren(
      ...state.toasts.map((toast) =>
        el('div', {
          class: 'ap-toast',
          'data-kind': toast.kind,
          role: 'status',
          text: toast.text,
          onclick: () => store.dismissToast(toast.id),
        }),
      ),
    )
  }

  document.body.replaceChildren(root)
  store.subscribe(render)
  void store.send({ type: 'ui:meters', enabled: true })

  window.addEventListener('hashchange', () => {
    const next = location.hash.slice(1) as PaneId
    if (PANES.some((p) => p.id === next)) select(next)
  })
}

mount()

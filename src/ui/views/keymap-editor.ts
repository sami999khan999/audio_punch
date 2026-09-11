/**
 * Shortcut editor.
 *
 * Rebinding captures the next key press rather than asking anyone to type an
 * accelerator string. Conflicts are shown before the binding is saved, because
 * finding out by pressing the key and getting the wrong action is worse.
 */
import { DEFAULT_KEYMAP } from '../../shared/defaults.ts'
import { el } from '../core/dom.ts'
import { createPillEl } from '../controls/switch.ts'
import { ACTION_CATALOG, acceleratorFromEvent, formatAccelerator } from '../../content/keymap.ts'
import type { UiState, UiStore } from '../core/store.ts'

export interface KeymapEditorHandle {
  el: HTMLElement
  update(state: UiState): void
}

const BROWSER_SHORTCUTS: Array<[string, string]> = [
  ['Show / hide the mixer', 'Alt + Shift + A'],
  ['Global chain on / off', 'Alt + Shift + G'],
  ['Mute every tab', 'Alt + Shift + M'],
  ['Bypass all processing', 'Alt + Shift + B'],
]

export function createKeymapEditor(store: UiStore): KeymapEditorHandle {
  let state = store.get()
  let capturing: string | null = null

  const list = el('div', { class: 'ap-list' })

  const browserCard = el('div', { class: 'ap-glass ap-card' }, [
    el('div', { class: 'ap-label', style: 'margin-bottom:10px', text: 'Browser shortcuts' }),
    ...BROWSER_SHORTCUTS.map(([label, keys]) =>
      el('div', { class: 'ap-help-row' }, [
        el('span', { text: label }),
        el('span', { class: 'ap-kbd', text: keys }),
      ]),
    ),
    el('div', {
      class: 'ap-listrow-sub',
      style: 'margin-top:12px;white-space:normal',
      text:
        'The browser allows an extension four shortcuts that work with nothing on screen. ' +
        'Change these at chrome://extensions/shortcuts — everything below works while the mixer is open.',
    }),
  ])

  const root = el('div', { class: 'ap-section' }, [
    browserCard,
    el('div', {}, [
      el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:8px' }, [
        el('div', { class: 'ap-label', style: 'flex:1', text: 'Mixer shortcuts' }),
        createPillEl({
          label: 'Restore defaults',
          onClick: () => {
            void store.send({ type: 'ui:set-keymap', keymap: structuredClone(DEFAULT_KEYMAP) })
          },
        }),
      ]),
      list,
    ]),
  ])

  /** Actions already bound to an accelerator, excluding the one being changed. */
  function conflicts(accelerator: string, exceptActionId: string): string[] {
    const keymap = state.snapshot.settings.keymap
    return Object.entries(keymap)
      .filter(([id, accels]) => id !== exceptActionId && accels.includes(accelerator))
      .map(([id]) => ACTION_CATALOG.find((a) => a.id === id)?.label ?? id)
  }

  function bind(actionId: string, accelerator: string): void {
    const keymap = structuredClone(state.snapshot.settings.keymap)
    // A binding is exclusive: taking a key removes it from whoever had it, so
    // the map can never reach a state where two actions fight over one press.
    for (const [id, accels] of Object.entries(keymap)) {
      if (id === actionId) continue
      keymap[id] = accels.filter((a) => a !== accelerator)
    }
    keymap[actionId] = [accelerator]
    void store.send({ type: 'ui:set-keymap', keymap })
  }

  function render(): void {
    const keymap = state.snapshot.settings.keymap
    const groups = new Map<string, HTMLElement>()
    list.replaceChildren()

    for (const action of ACTION_CATALOG) {
      let group = groups.get(action.group)
      if (!group) {
        group = el('div', { style: 'margin-bottom:14px' }, [
          el('div', { class: 'ap-label', style: 'margin-bottom:6px', text: action.group }),
        ])
        groups.set(action.group, group)
        list.append(group)
      }

      const accelerator = keymap[action.id]?.[0]
      const isCapturing = capturing === action.id
      const clash = accelerator ? conflicts(accelerator, action.id) : []

      const keyButton = el('button', {
        class: 'ap-pill',
        type: 'button',
        style: 'min-width:120px;justify-content:center',
        'data-on': String(isCapturing),
        text: isCapturing ? 'Press a key…' : accelerator ? formatAccelerator(accelerator) : 'Unbound',
        title: isCapturing ? 'Press the key you want, or Escape to cancel' : 'Click to rebind',
        onclick: () => {
          capturing = isCapturing ? null : action.id
          render()
        },
        onkeydown: (event: Event) => {
          if (capturing !== action.id) return
          const keyEvent = event as KeyboardEvent
          event.preventDefault()
          event.stopPropagation()
          if (keyEvent.key === 'Escape') {
            capturing = null
            render()
            return
          }
          const next = acceleratorFromEvent(keyEvent)
          if (!next) return
          capturing = null
          bind(action.id, next)
        },
      })
      if (isCapturing) requestAnimationFrame(() => keyButton.focus())

      group.append(
        el('div', { class: 'ap-listrow' }, [
          el('div', { class: 'ap-listrow-main' }, [
            el('div', { class: 'ap-listrow-title', text: action.label }),
            clash.length > 0
              ? el('div', {
                  class: 'ap-listrow-sub',
                  style: 'color:var(--ap-hot)',
                  text: `Also bound to ${clash.join(', ')}`,
                })
              : null,
          ]),
          keyButton,
        ]),
      )
    }
  }

  return {
    el: root,
    update(next) {
      state = next
      render()
    },
  }
}

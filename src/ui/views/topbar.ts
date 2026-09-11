/**
 * The top bar: identity, the controls that act on everything, and the way out.
 */
import { el } from '../core/dom.ts'
import { createIconButton, createPill, type PillHandle } from '../controls/switch.ts'
import type { UiState } from '../core/store.ts'

export interface TopBarHandle {
  el: HTMLElement
  update(state: UiState): void
}

export interface TopBarOptions {
  showClose: boolean
  showWordmark?: boolean
  onBypassAll: (on: boolean) => void
  onMuteAll: (on: boolean) => void
  onHelp: () => void
  onDashboard: () => void
  onClose: () => void
}

export function createTopBar(options: TopBarOptions): TopBarHandle {
  let bypass = false
  let mute = false

  const bypassPill: PillHandle = createPill({
    label: 'Bypass',
    tone: 'hot',
    title: 'Pass every tab through untouched',
    onClick: () => options.onBypassAll(!bypass),
  })
  const mutePill: PillHandle = createPill({
    label: 'Mute all',
    tone: 'hot',
    title: 'Silence every processed tab',
    onClick: () => options.onMuteAll(!mute),
  })

  const root = el('div', { class: 'ap-top' }, [
    options.showWordmark === false
      ? null
      : el('div', { class: 'ap-brand' }, [
          el('b', { text: 'Audio' }),
          el('span', { text: 'Punch' }),
        ]),
    el('div', { class: 'ap-spacer' }),
    bypassPill.el,
    mutePill.el,
    createIconButton({ icon: '?', title: 'Keyboard shortcuts', onClick: options.onHelp }).el,
    createIconButton({ icon: '⤢', title: 'Open the full desk', onClick: options.onDashboard }).el,
    options.showClose
      ? createIconButton({ icon: '✕', title: 'Close (Esc)', onClick: options.onClose }).el
      : null,
  ])

  return {
    el: root,
    update(state) {
      bypass = state.snapshot.settings.bypassAll
      mute = state.snapshot.settings.muteAll
      bypassPill.set(bypass)
      mutePill.set(mute)
    },
  }
}

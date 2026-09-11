/**
 * The channel rail: the global bus followed by one strip per tab.
 *
 * The strip's left edge carries its state — unlit when idle, tungsten when the
 * tab is armed, teal for the global bus. That single element replaces a status
 * badge, a colour dot and a text label, which is what keeps a strip readable at
 * 30 pixels tall.
 */
import { prettyOrigin } from '../../shared/origin.ts'
import type { StateSnapshot, TabInfo, TargetKey } from '../../shared/types.ts'
import { el } from '../core/dom.ts'
import { createMeter, type MeterHandle } from '../controls/meter.ts'
import type { UiState } from '../core/store.ts'

export interface RailHandle {
  el: HTMLElement
  update(state: UiState): void
}

export interface RailOptions {
  onSelect: (target: TargetKey, tabId: number | null) => void
  onToggleGlobal: (on: boolean) => void
  onArm: (tab: TabInfo) => void
  onRelease: (tab: TabInfo) => void
}

/** Identity of the rendered list, so it is only rebuilt when it really changes. */
function signature(snapshot: StateSnapshot): string {
  return snapshot.tabs
    .map((t) => `${t.tabId}:${t.armed}:${t.arming}:${t.audible}:${t.blocked}:${t.origin}:${t.title}`)
    .join('|')
}

function describeTab(tab: TabInfo, globalOn: boolean, ignoresGlobal: boolean): string {
  if (tab.blocked === 'drm') return 'Protected playback'
  if (tab.blocked === 'capture-failed') return 'Capture refused'
  if (tab.arming) return 'Arming…'
  if (!tab.armed) return tab.audible ? 'Playing — not captured' : 'Idle'
  if (globalOn && !ignoresGlobal) return 'Following global'
  return 'Own chain'
}

export function createChannelRail(options: RailOptions): RailHandle {
  const root = el('div', { class: 'ap-channels', role: 'listbox', 'aria-label': 'Channels' })
  const meters = new Map<number, MeterHandle>()
  let rendered = ''
  let selected: TargetKey = 'global'

  function buildGlobal(state: UiState): HTMLElement {
    const { settings, tabs } = state.snapshot
    const on = settings.global.on
    const following = tabs.filter((t) => !settings.sites[t.origin]?.ignoreGlobal).length

    const toggle = el('button', {
      class: 'ap-cap',
      type: 'button',
      text: on ? 'On' : 'Off',
      'data-tone': 'bus',
      'data-on': String(on),
      'aria-pressed': String(on),
      title: 'Apply one chain to every tab',
      onclick: (event: Event) => {
        event.stopPropagation()
        options.onToggleGlobal(!on)
      },
    })

    return el(
      'div',
      {
        class: 'ap-strip',
        role: 'option',
        tabindex: '0',
        'data-bus': 'true',
        'data-armed': String(on),
        'data-selected': String(selected === 'global'),
        'aria-selected': String(selected === 'global'),
        onclick: () => options.onSelect('global', null),
        onkeydown: (event: Event) => {
          const key = (event as KeyboardEvent).key
          if (key === 'Enter' || key === ' ') {
            event.preventDefault()
            options.onSelect('global', null)
          }
        },
      },
      [
        el('div', { class: 'ap-strip-edge' }),
        el('div', { class: 'ap-strip-main' }, [
          el('div', { class: 'ap-strip-name', text: 'Global' }),
          el('div', {
            class: 'ap-strip-sub',
            text: on ? `Driving ${following} tab${following === 1 ? '' : 's'}` : 'Tabs use their own',
          }),
        ]),
        toggle,
      ],
    )
  }

  function buildTab(state: UiState, tab: TabInfo): HTMLElement {
    const { settings } = state.snapshot
    const site = settings.sites[tab.origin]
    const ignoresGlobal = site?.ignoreGlobal === true
    const target: TargetKey = `site:${tab.origin}`
    const isSelected = selected === target && state.targetTabId === tab.tabId
    const followingGlobal = settings.global.on && !ignoresGlobal

    const meter = createMeter()
    meters.set(tab.tabId, meter)

    const action = el('button', {
      class: 'ap-cap',
      type: 'button',
      text: tab.armed ? 'Live' : 'Arm',
      'data-on': String(tab.armed),
      title: tab.armed ? 'Stop processing this tab' : 'Route this tab through Audio Punch',
      onclick: (event: Event) => {
        event.stopPropagation()
        if (tab.armed) options.onRelease(tab)
        else options.onArm(tab)
      },
    })

    const tags = el('div', { class: 'ap-strip-tags' }, [
      followingGlobal ? el('span', { class: 'ap-tag', 'data-tone': 'bus', text: 'Global' }) : null,
      ignoresGlobal ? el('span', { class: 'ap-tag', 'data-tone': 'lit', text: 'Pinned' }) : null,
    ])

    return el(
      'div',
      {
        class: 'ap-strip',
        role: 'option',
        tabindex: '0',
        'data-armed': String(tab.armed),
        'data-selected': String(isSelected),
        'aria-selected': String(isSelected),
        onclick: () => options.onSelect(target, tab.tabId),
        onkeydown: (event: Event) => {
          const key = (event as KeyboardEvent).key
          if (key === 'Enter' || key === ' ') {
            event.preventDefault()
            options.onSelect(target, tab.tabId)
          }
        },
      },
      [
        el('div', { class: 'ap-strip-edge' }),
        el('div', { class: 'ap-strip-main' }, [
          el('div', { class: 'ap-strip-name', text: tab.title || prettyOrigin(tab.origin) }),
          el('div', {
            class: 'ap-strip-sub',
            'data-tone': tab.blocked ? 'warn' : 'normal',
            text: `${prettyOrigin(tab.origin)} · ${describeTab(tab, settings.global.on, ignoresGlobal)}`,
          }),
          tags.childElementCount > 0 ? tags : null,
        ]),
        el('div', { style: 'display:flex;align-items:center;gap:7px' }, [meter.el, action]),
      ],
    )
  }

  function rebuild(state: UiState): void {
    meters.clear()
    root.replaceChildren(buildGlobal(state), ...state.snapshot.tabs.map((tab) => buildTab(state, tab)))

    if (state.snapshot.tabs.length === 0) {
      root.append(
        el('div', { class: 'ap-strip-sub', style: 'padding:10px 9px;white-space:normal' }, [
          'No tabs are playing audio yet. Start something, then open this panel there.',
        ]),
      )
    }
  }

  return {
    el: root,
    update(state) {
      selected = state.target
      const next = `${signature(state.snapshot)}::${state.target}::${state.targetTabId}::${state.snapshot.settings.global.on}::${Object.keys(state.snapshot.settings.sites).join(',')}`
      if (next !== rendered) {
        rendered = next
        rebuild(state)
      }
      for (const [tabId, meter] of meters) meter.set(state.levels[tabId])
    },
  }
}

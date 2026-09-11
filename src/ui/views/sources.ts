/**
 * The source cards: the global bus, then one card per page making sound.
 *
 * Each card carries its own level slider, so the common adjustment — turn this
 * tab down — takes one drag without selecting anything first. Clicking the card
 * selects it for the module rack below.
 */
import { prettyOrigin } from '../../shared/origin.ts'
import { PARAMS } from '../../shared/params.ts'
import type { ChainState, StateSnapshot, TabInfo, TargetKey } from '../../shared/types.ts'
import { el } from '../core/dom.ts'
import { createSlider, type SliderHandle } from '../controls/slider.ts'
import type { UiState } from '../core/store.ts'

export interface SourcesHandle {
  el: HTMLElement
  update(state: UiState): void
  destroy(): void
}

export interface SourcesOptions {
  onSelect: (target: TargetKey, tabId: number | null) => void
  onLevel: (target: TargetKey, level: number) => void
  onToggleGlobal: (on: boolean) => void
}

/** Rebuild only when the list really changes, so drags are never interrupted. */
function signature(snapshot: StateSnapshot): string {
  return snapshot.tabs
    .map((t) => `${t.tabId}:${t.origin}:${t.title}:${t.hooked}:${t.silent}:${t.audible}`)
    .join('|')
}

/** One status line per card. The silent case is carried by its own chip, so it
 *  is deliberately not repeated here. */
function statusOf(tab: TabInfo, globalOn: boolean, pinned: boolean): string {
  if (tab.hooked === 0) return tab.hasMediaElements ? 'Ready' : 'No media yet'
  if (globalOn && !pinned) return 'Following global'
  return 'Own chain'
}

export function createSources(options: SourcesOptions): SourcesHandle {
  const root = el('div', { class: 'ap-cards ap-scroll', role: 'listbox', 'aria-label': 'Sources' })
  const levelSliders = new Map<string, SliderHandle>()
  /** Readouts beside each card's slider, updated in step with it. */
  const levelValues = new Map<string, HTMLElement>()
  let rendered = ''

  function card(opts: {
    key: string
    target: TargetKey
    tabId: number | null
    selected: boolean
    bus: boolean
    icon: Node | string
    name: string
    sub: string
    chain: ChainState
    tags: Node[]
    action?: Node
  }): HTMLElement {
    const slider = createSlider({
      spec: PARAMS.gain.level,
      value: opts.chain.gain.level,
      tone: opts.bus ? 'accent' : 'plain',
      onInput: (level) => options.onLevel(opts.target, level),
    })
    levelSliders.set(opts.key, slider)

    const value = el('span', { class: 'ap-num ap-tile-val' })
    value.textContent = `${Math.round(opts.chain.gain.level * 100)}%`
    levelValues.set(opts.key, value)

    return el(
      'div',
      {
        class: 'ap-tile',
        role: 'option',
        tabindex: '0',
        'data-bus': String(opts.bus),
        'data-selected': String(opts.selected),
        'aria-selected': String(opts.selected),
        onclick: () => options.onSelect(opts.target, opts.tabId),
        onkeydown: (event: Event) => {
          const key = (event as KeyboardEvent).key
          if (key === 'Enter' || key === ' ') {
            event.preventDefault()
            options.onSelect(opts.target, opts.tabId)
          }
        },
      },
      [
        el('div', { class: 'ap-tile-head' }, [
          el('div', { class: 'ap-tile-icon' }, [typeof opts.icon === 'string' ? opts.icon : opts.icon]),
          el('div', { class: 'ap-tile-text' }, [
            el('div', { class: 'ap-tile-name', text: opts.name }),
            el('div', { class: 'ap-tile-sub', text: opts.sub }),
          ]),
          opts.action ?? null,
        ]),
        opts.tags.length > 0 ? el('div', { class: 'ap-wrap' }, opts.tags) : null,
        el('div', { class: 'ap-tile-foot' }, [slider.el, value]),
      ],
    )
  }

  function rebuild(state: UiState): void {
    for (const slider of levelSliders.values()) slider.destroy()
    levelSliders.clear()
    levelValues.clear()

    const { settings, tabs } = state.snapshot
    const globalOn = settings.global.on

    const globalCard = card({
      key: 'global',
      target: 'global',
      tabId: null,
      selected: state.target === 'global',
      bus: true,
      icon: '◎',
      name: 'Global',
      sub: globalOn
        ? `Driving ${tabs.filter((t) => !settings.sites[t.origin]?.ignoreGlobal).length} tab(s)`
        : 'Tabs use their own',
      chain: settings.global.chain,
      tags: [],
      action: el('button', {
        class: 'ap-switch',
        type: 'button',
        role: 'switch',
        'data-on': String(globalOn),
        'aria-checked': String(globalOn),
        'aria-label': 'Apply one chain to every tab',
        title: 'Apply one chain to every tab',
        onclick: (event: Event) => {
          event.stopPropagation()
          options.onToggleGlobal(!globalOn)
        },
      }),
    })

    const tabCards = tabs.map((tab) => {
      const site = settings.sites[tab.origin]
      const pinned = site?.ignoreGlobal === true
      const target: TargetKey = `site:${tab.origin}`
      const following = globalOn && !pinned
      const chain = following ? settings.global.chain : (site?.chain ?? settings.global.chain)

      const icon = tab.favIconUrl
        ? el('img', { src: tab.favIconUrl, alt: '', loading: 'lazy' })
        : '♪'

      return card({
        key: `tab:${tab.tabId}`,
        target,
        tabId: tab.tabId,
        selected: state.target === target && state.targetTabId === tab.tabId,
        bus: false,
        icon,
        name: prettyOrigin(tab.origin),
        sub: tab.title || prettyOrigin(tab.origin),
        chain,
        // One chip for where the settings come from, one only if something is
        // wrong. "Global" and "Following global" said the same thing twice.
        tags: [
          pinned ? el('span', { class: 'ap-chip', text: 'Pinned' }) : null,
          tab.silent
            ? el('span', {
                class: 'ap-chip',
                'data-tone': 'hot',
                text: 'No signal — cross-origin audio',
              })
            : el('span', {
                class: 'ap-chip',
                'data-tone': following ? 'accent' : 'plain',
                text: statusOf(tab, globalOn, pinned),
              }),
        ].filter(Boolean) as Node[],
      })
    })

    root.replaceChildren(globalCard, ...tabCards)

    if (tabs.length === 0) {
      root.append(
        el('div', { class: 'ap-empty', style: 'grid-column:1/-1' }, [
          el('strong', { text: 'Nothing playing yet' }),
          el('span', {
            text: 'Start some audio in a tab and it appears here. Global is always available.',
          }),
        ]),
      )
    }
  }

  return {
    el: root,
    update(state) {
      const next = `${signature(state.snapshot)}::${state.target}::${state.targetTabId}::${state.snapshot.settings.global.on}::${Object.keys(state.snapshot.settings.sites).join(',')}`
      if (next !== rendered) {
        rendered = next
        rebuild(state)
      }
      // Levels still track live changes without a rebuild.
      const { settings } = state.snapshot
      const show = (key: string, level: number) => {
        levelSliders.get(key)?.set(level)
        const value = levelValues.get(key)
        if (value) value.textContent = `${Math.round(level * 100)}%`
      }
      show('global', settings.global.chain.gain.level)
      for (const tab of state.snapshot.tabs) {
        const site = settings.sites[tab.origin]
        const following = settings.global.on && site?.ignoreGlobal !== true
        const chain = following ? settings.global.chain : (site?.chain ?? settings.global.chain)
        show(`tab:${tab.tabId}`, chain.gain.level)
      }
    },
    destroy() {
      for (const slider of levelSliders.values()) slider.destroy()
    },
  }
}

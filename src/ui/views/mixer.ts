/**
 * The mixing desk: top bar, master rail, source cards, module rack, side column.
 *
 * Shared verbatim by the overlay and the dashboard. It also exposes the action
 * surface the keyboard map drives, so a shortcut and a click go through exactly
 * the same code path — there is no second implementation to drift.
 */
import { clamp, PARAMS } from '../../shared/params.ts'
import { EQ_FREQUENCIES, type ChainState, type ModuleId, type TargetKey } from '../../shared/types.ts'
import { prettyOrigin } from '../../shared/origin.ts'
import { el } from '../core/dom.ts'
import type { UiState, UiStore } from '../core/store.ts'
import { createTopBar } from './topbar.ts'
import { createSources } from './sources.ts'
import { createSide } from './side.ts'
import { createRack, type RackHandle } from './rack.ts'
import { createVSlider } from '../controls/slider.ts'

const EQ_SPEC = PARAMS.eq.band

export interface MixerActions {
  selectRelative(offset: number): void
  selectGlobal(): void
  patch(patch: Partial<ChainState>): void
  toggleModule(id: ModuleId): void
  toggleBypass(): void
  nudgeGain(steps: number): void
  toggleMute(): void
  moveEqBand(offset: number): void
  nudgeEqBand(deltaDb: number): void
  flattenEq(): void
  resetTarget(): void
  toggleIgnoreGlobal(): void
  toggleGlobal(): void
  applyTemplateSlot(index: number): void
  removeTemplate(): void
  openDashboard(): void
}

export interface MixerHandle {
  el: HTMLElement
  update(state: UiState): void
  actions: MixerActions
  chain(): ChainState
}

export interface MixerOptions {
  store: UiStore
  showClose: boolean
  showWordmark?: boolean
  onHelp: () => void
  onClose: () => void
}

function chainFor(state: UiState, target: TargetKey): ChainState {
  const { settings } = state.snapshot
  if (target === 'global') return settings.global.chain
  return settings.sites[target.slice('site:'.length)]?.chain ?? settings.global.chain
}

export function createMixer(options: MixerOptions): MixerHandle {
  const { store } = options
  let state = store.get()
  let rack: RackHandle | null = null
  let rackTarget: TargetKey | null = null
  let group = 'Core'

  const currentChain = () => chainFor(state, state.target)

  function patch(value: Partial<ChainState>): void {
    // Pushed rather than sent: slider drags produce a stream of these and none
    // of them needs a reply.
    store.push({ type: 'ui:patch-chain', target: state.target, patch: value })
  }

  function patchTarget(target: TargetKey, value: Partial<ChainState>): void {
    store.push({ type: 'ui:patch-chain', target, patch: value })
  }

  // ── master rail ────────────────────────────────────────────────────────
  const master = createVSlider({
    spec: PARAMS.gain.level,
    value: currentChain().gain.level,
    label: 'Level for the selected source',
    onInput: (level) => patch({ gain: { level, mute: currentChain().gain.mute } }),
  })
  const masterValue = el('div', { class: 'ap-num', style: 'color:var(--ap-ink-3)' })
  const rail = el('div', { class: 'ap-rail' }, [
    el('div', { class: 'ap-label', style: 'writing-mode:vertical-rl;transform:rotate(180deg)', text: 'Level' }),
    master.el,
    masterValue,
  ])

  // ── hero ───────────────────────────────────────────────────────────────
  const heroTitle = el('div', { class: 'ap-display' })
  const heroMeta = el('div', { class: 'ap-hero-meta' })
  const hero = el('div', { class: 'ap-hero' }, [heroTitle, heroMeta])

  // ── sources + rack ─────────────────────────────────────────────────────
  const sources = createSources({
    onSelect: (target, tabId) => store.selectTarget(target, tabId),
    onLevel: (target, level) => {
      const chain = chainFor(state, target)
      patchTarget(target, { gain: { level, mute: chain.gain.mute } })
    },
    onToggleGlobal: (on) => void store.send({ type: 'ui:set-global-on', on }),
  })

  const rackHost = el('div', { class: 'ap-col', style: 'flex:1 1 auto;min-height:0' })
  const main = el('div', { class: 'ap-col ap-col-main' }, [
    hero,
    el('div', { style: 'flex:0 1 auto;max-height:44%;display:flex;min-height:110px' }, [sources.el]),
    rackHost,
  ])

  const side = createSide(store, () => state.target)

  const topBar = createTopBar({
    showClose: options.showClose,
    showWordmark: options.showWordmark,
    onBypassAll: (value) => void store.send({ type: 'ui:bypass-all', value }),
    onMuteAll: (value) => void store.send({ type: 'ui:mute-all', value }),
    onHelp: options.onHelp,
    onDashboard: () => void store.send({ type: 'ui:open-dashboard' }),
    onClose: options.onClose,
  })

  const body = el('div', { class: 'ap-body' }, [rail, main, side.el])
  const root = el('div', { style: 'display:contents' }, [topBar.el, body])

  function disabledModules(): Partial<Record<ModuleId, string>> {
    const tab = store.selectedTab()
    if (!tab) return {}
    const out: Partial<Record<ModuleId, string>> = {}
    if (!tab.hasMediaElements) {
      out.speed = 'Speed needs an audio or video element on the page.'
    }
    return out
  }

  function rebuildRack(): void {
    rack?.destroy()
    rack = createRack({
      chain: currentChain(),
      eqBand: state.eqBand,
      group,
      disabled: disabledModules(),
      onPatch: patch,
      onFocusBand: (index) => store.set({ eqBand: index }),
      onGroupChange: (title) => {
        group = title
      },
    })
    rackTarget = state.target
    rackHost.replaceChildren(rack.el)
  }

  // ── keyboard actions ───────────────────────────────────────────────────

  function selectable(): Array<{ target: TargetKey; tabId: number | null }> {
    return [
      { target: 'global' as TargetKey, tabId: null },
      ...state.snapshot.tabs.map((tab) => ({
        target: `site:${tab.origin}` as TargetKey,
        tabId: tab.tabId,
      })),
    ]
  }

  const actions: MixerActions = {
    selectRelative(offset) {
      const list = selectable()
      const index = list.findIndex(
        (entry) => entry.target === state.target && entry.tabId === state.targetTabId,
      )
      const next = list[(Math.max(0, index) + offset + list.length) % list.length]
      if (next) store.selectTarget(next.target, next.tabId)
    },
    selectGlobal: () => store.selectTarget('global', null),
    patch,
    toggleModule(id) {
      const module = currentChain()[id] as { on?: boolean }
      if (typeof module.on !== 'boolean') return
      patch({ [id]: { on: !module.on } } as Partial<ChainState>)
    },
    toggleBypass: () => patch({ bypass: !currentChain().bypass }),
    nudgeGain(steps) {
      const spec = PARAMS.gain.level
      const chain = currentChain()
      patch({
        gain: {
          level: clamp(Number((chain.gain.level + steps * 0.05).toFixed(3)), spec.min, spec.max),
          mute: chain.gain.mute,
        },
      })
    },
    toggleMute() {
      const chain = currentChain()
      patch({ gain: { level: chain.gain.level, mute: !chain.gain.mute } })
    },
    moveEqBand(offset) {
      store.set({ eqBand: (state.eqBand + offset + EQ_FREQUENCIES.length) % EQ_FREQUENCIES.length })
    },
    nudgeEqBand(deltaDb) {
      const bands = currentChain().eq.bands.map((gain, i) =>
        i === state.eqBand ? clamp(gain + deltaDb, EQ_SPEC.min, EQ_SPEC.max) : gain,
      )
      patch({ eq: { on: true, bands } })
    },
    flattenEq() {
      patch({ eq: { on: currentChain().eq.on, bands: EQ_FREQUENCIES.map(() => 0) } })
    },
    resetTarget: () => void store.send({ type: 'ui:reset-chain', target: state.target }),
    toggleIgnoreGlobal() {
      if (state.target === 'global') return
      const origin = state.target.slice('site:'.length)
      const current = state.snapshot.settings.sites[origin]?.ignoreGlobal === true
      void store.send({ type: 'ui:set-ignore-global', origin, value: !current })
    },
    toggleGlobal() {
      void store.send({ type: 'ui:set-global-on', on: !state.snapshot.settings.global.on })
    },
    applyTemplateSlot(index) {
      const template = state.snapshot.settings.templates[index]
      if (!template) {
        store.pushToast('warn', `No template in slot ${index + 1}.`)
        return
      }
      void store.send({ type: 'ui:apply-template', templateId: template.id, target: state.target })
    },
    removeTemplate: () => void store.send({ type: 'ui:remove-template', target: state.target }),
    openDashboard: () => void store.send({ type: 'ui:open-dashboard' }),
  }

  function renderHero(): void {
    const { settings } = state.snapshot
    const tab = store.selectedTab()
    const isGlobal = state.target === 'global'
    heroTitle.textContent = isGlobal
      ? 'Global'
      : prettyOrigin(state.target.slice('site:'.length))

    const chain = currentChain()
    const engaged = Object.values(chain).filter(
      (module) => typeof module === 'object' && module !== null && (module as { on?: boolean }).on === true,
    ).length

    const chips: Node[] = []
    if (isGlobal) {
      chips.push(
        el('span', {
          class: 'ap-chip',
          'data-tone': settings.global.on ? 'accent' : 'plain',
          text: settings.global.on ? 'Driving every tab' : 'Off',
        }),
      )
    } else if (tab) {
      const pinned = settings.sites[tab.origin]?.ignoreGlobal === true
      if (settings.global.on && !pinned) {
        chips.push(el('span', { class: 'ap-chip', 'data-tone': 'accent', text: 'Following global' }))
      }
      if (pinned) chips.push(el('span', { class: 'ap-chip', text: 'Pinned off global' }))
      if (tab.silent) {
        chips.push(el('span', { class: 'ap-chip', 'data-tone': 'hot', text: 'No signal reaching the engine' }))
      }
    }
    chips.push(el('span', { class: 'ap-chip', text: engaged === 0 ? 'Flat' : `${engaged} engaged` }))
    if (chain.bypass) chips.push(el('span', { class: 'ap-chip', 'data-tone': 'hot', text: 'Bypassed' }))
    heroMeta.replaceChildren(...chips)
  }

  return {
    el: root,
    actions,
    chain: currentChain,
    update(next) {
      state = next
      const chain = currentChain()

      topBar.update(state)
      sources.update(state)
      side.update(state)
      renderHero()

      master.set(chain.gain.level)
      masterValue.textContent = `${Math.round(chain.gain.level * 100)}%`
      const tabId = state.targetTabId
      master.setLevel(tabId === null ? 0 : (state.levels[tabId]?.peak ?? 0))

      if (rackTarget !== state.target) rebuildRack()
      rack?.update(chain, state.eqBand, tabId === null ? 0 : (state.levels[tabId]?.reduction ?? 0))
    },
  }
}

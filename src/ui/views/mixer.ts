/**
 * The mixing desk: top rail, channel rail and module rack, wired to the store.
 *
 * Shared verbatim by the overlay and the dashboard. It also exposes the action
 * surface the keyboard map drives, so a shortcut and a click go through
 * exactly the same code path — there is no second implementation to drift.
 */
import { clamp, PARAMS } from '../../shared/params.ts'
import { engagedModules } from '../../shared/defaults.ts'
import { EQ_FREQUENCIES, type ChainState, type ModuleId, type TargetKey } from '../../shared/types.ts'
import { el } from '../core/dom.ts'
import type { UiState, UiStore } from '../core/store.ts'
import { createHeader } from './header.ts'
import { createChannelRail } from './strip.ts'
import { createRack, type RackHandle } from './rack.ts'

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
  armSelected(): void
  applyTemplateSlot(index: number): void
  removeTemplate(): void
  openDashboard(): void
}

export interface MixerHandle {
  el: HTMLElement
  update(state: UiState): void
  actions: MixerActions
  /** The chain the rack is currently editing. */
  chain(): ChainState
}

export interface MixerOptions {
  store: UiStore
  showClose: boolean
  showWordmark?: boolean
  onHelp: () => void
  onClose: () => void
}

/** The chain a target is editing, straight from the last snapshot. */
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

  const deskInner = el('div', { class: 'ap-desk' })

  function currentChain(): ChainState {
    return chainFor(state, state.target)
  }

  function patch(patchValue: Partial<ChainState>): void {
    // Pushed rather than sent: knob drags produce a stream of these and none of
    // them needs a reply.
    store.push({ type: 'ui:patch-chain', target: state.target, patch: patchValue })
  }

  const header = createHeader({
    showClose: options.showClose,
    showWordmark: options.showWordmark,
    onApplyTemplate: (templateId) => {
      void store.send({ type: 'ui:apply-template', templateId, target: state.target })
    },
    onRemoveTemplate: () => {
      void store.send({ type: 'ui:remove-template', target: state.target })
    },
    onSaveTemplate: (name) => {
      void store.send({
        type: 'ui:save-template',
        name,
        description: '',
        modules: engagedModules(currentChain()),
        source: state.target,
      })
    },
    onBypassAll: (value) => void store.send({ type: 'ui:bypass-all', value }),
    onMuteAll: (value) => void store.send({ type: 'ui:mute-all', value }),
    onReset: () => void store.send({ type: 'ui:reset-chain', target: state.target }),
    onHelp: options.onHelp,
    onDashboard: () => void store.send({ type: 'ui:open-dashboard' }),
    onClose: options.onClose,
  })

  const rail = createChannelRail({
    onSelect: (target, tabId) => store.selectTarget(target, tabId),
    onToggleGlobal: (on) => void store.send({ type: 'ui:set-global-on', on }),
    onArm: (tab) => void store.send({ type: 'ui:arm', tabId: tab.tabId, confirmDrm: tab.blocked === 'drm' }),
    onRelease: (tab) => void store.send({ type: 'ui:release', tabId: tab.tabId }),
  })

  const body = el('div', { class: 'ap-body' }, [rail.el, deskInner])
  const root = el('div', { style: 'display:contents' }, [header.el, body])

  function rebuildRack(): void {
    rack?.destroy()
    const chain = currentChain()
    rack = createRack({
      chain,
      eqBand: state.eqBand,
      disabled: disabledModules(),
      onPatch: patch,
      onFocusBand: (index) => store.set({ eqBand: index }),
    })
    rackTarget = state.target
    deskInner.replaceChildren(rack.el)
  }

  /** Modules that cannot act on the selected strip, with the reason to show. */
  function disabledModules(): Partial<Record<ModuleId, string>> {
    const tab = store.selectedTab()
    if (!tab) return {}
    const out: Partial<Record<ModuleId, string>> = {}
    if (!tab.hasMediaElements) {
      out.speed = 'Speed needs an audio or video element on the page.'
    }
    return out
  }

  // ------------------------------------------------------------ keyboard

  function selectableTargets(): Array<{ target: TargetKey; tabId: number | null }> {
    return [
      { target: 'global' as TargetKey, tabId: null },
      ...state.snapshot.tabs.map((tab) => ({
        target: `site:${tab.origin}` as TargetKey,
        tabId: tab.tabId,
      })),
    ]
  }

  function toggleModuleFlag(id: ModuleId): void {
    const chain = currentChain()
    const module = chain[id] as { on?: boolean }
    if (typeof module.on !== 'boolean') return
    patch({ [id]: { on: !module.on } } as Partial<ChainState>)
  }

  const actions: MixerActions = {
    selectRelative(offset) {
      const list = selectableTargets()
      const index = list.findIndex(
        (entry) => entry.target === state.target && entry.tabId === state.targetTabId,
      )
      const next = list[(Math.max(0, index) + offset + list.length) % list.length]
      if (next) store.selectTarget(next.target, next.tabId)
    },
    selectGlobal: () => store.selectTarget('global', null),
    patch,
    toggleModule: toggleModuleFlag,
    toggleBypass: () => patch({ bypass: !currentChain().bypass }),
    nudgeGain(steps) {
      const spec = PARAMS.gain.level
      const chain = currentChain()
      const next = clamp(
        Number((chain.gain.level + steps * 0.05).toFixed(3)),
        spec.min,
        spec.max,
      )
      patch({ gain: { level: next, mute: chain.gain.mute } })
    },
    toggleMute() {
      const chain = currentChain()
      patch({ gain: { level: chain.gain.level, mute: !chain.gain.mute } })
    },
    moveEqBand(offset) {
      const next = (state.eqBand + offset + EQ_FREQUENCIES.length) % EQ_FREQUENCIES.length
      store.set({ eqBand: next })
    },
    nudgeEqBand(deltaDb) {
      const chain = currentChain()
      const bands = chain.eq.bands.map((gain, i) =>
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
    armSelected() {
      const tab = store.selectedTab()
      if (!tab) return
      if (tab.armed) void store.send({ type: 'ui:release', tabId: tab.tabId })
      else void store.send({ type: 'ui:arm', tabId: tab.tabId, confirmDrm: tab.blocked === 'drm' })
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

  return {
    el: root,
    actions,
    chain: currentChain,
    update(next) {
      state = next
      const chain = currentChain()
      header.update(state, chain)
      rail.update(state)
      if (rackTarget !== state.target) rebuildRack()
      const tabId = state.targetTabId
      rack?.update(chain, tabId === null ? undefined : state.levels[tabId], state.eqBand)
    },
  }
}

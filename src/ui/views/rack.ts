/**
 * The module rack: everything you can do to the selected source.
 *
 * Modules are grouped, and only the selected group is rendered — a wall of
 * forty sliders is not something anyone reads. Each group is one row of cards.
 *
 * Built once per target and updated in place. Rebuilding on every state
 * broadcast would tear a slider out from under the pointer mid-drag; the mixer
 * recreates the rack only when the selected source changes.
 */
import { MODULE_GROUPS, MODULE_LABELS, PARAMS, type ParamSpec } from '../../shared/params.ts'
import type { ChainState, ModuleId } from '../../shared/types.ts'
import { el } from '../core/dom.ts'
import { createSlider, type SliderHandle } from '../controls/slider.ts'
import { createSwitch, type SwitchHandle } from '../controls/switch.ts'
import { createEq, type EqHandle } from '../controls/eq.ts'

export type PatchFn = (patch: Partial<ChainState>) => void

export interface RackHandle {
  el: HTMLElement
  update(chain: ChainState, eqBand: number): void
  /** Which module group is on screen. */
  setGroup(title: string): void
  group(): string
  destroy(): void
}

export interface RackOptions {
  chain: ChainState
  eqBand: number
  group: string
  /** Modules the page cannot deliver, with the reason to show. */
  disabled?: Partial<Record<ModuleId, string>>
  onPatch: PatchFn
  onFocusBand: (index: number) => void
  onGroupChange: (title: string) => void
}

function readParam(chain: ChainState, module: ModuleId, key: string): number {
  return (chain[module] as unknown as Record<string, number>)[key] ?? 0
}

function paramSpec(module: ModuleId, key: string): ParamSpec {
  const group = (PARAMS as unknown as Record<string, Record<string, ParamSpec>>)[module]
  const spec = group?.[key]
  if (!spec) throw new Error(`No parameter spec for ${module}.${key}`)
  return spec
}

/** Which parameters each module shows, in order. */
const MODULE_PARAMS: Partial<Record<ModuleId, Array<[string, string]>>> = {
  gain: [['level', 'Volume']],
  pan: [['value', 'Balance']],
  tone: [
    ['bass', 'Bass'],
    ['treble', 'Treble'],
  ],
  filter: [
    ['highpass', 'High-pass'],
    ['lowpass', 'Low-pass'],
    ['resonance', 'Resonance'],
  ],
  comp: [
    ['threshold', 'Threshold'],
    ['ratio', 'Ratio'],
    ['attack', 'Attack'],
    ['release', 'Release'],
    ['knee', 'Knee'],
    ['makeup', 'Make-up'],
  ],
  limiter: [
    ['ceiling', 'Ceiling'],
    ['release', 'Release'],
  ],
  gate: [
    ['threshold', 'Threshold'],
    ['attack', 'Attack'],
    ['release', 'Release'],
    ['floor', 'Floor'],
  ],
  reverb: [
    ['mix', 'Mix'],
    ['size', 'Size'],
    ['decay', 'Decay'],
    ['damping', 'Damping'],
  ],
  delay: [
    ['mix', 'Mix'],
    ['time', 'Time'],
    ['feedback', 'Feedback'],
  ],
  width: [['amount', 'Width']],
  pitch: [['semitones', 'Pitch']],
  speed: [['rate', 'Rate']],
}

/** Extra boolean switches a module offers beyond its on/off. */
const MODULE_FLAGS: Partial<Record<ModuleId, Array<[string, string]>>> = {
  gain: [['mute', 'Mute']],
  delay: [['pingPong', 'Ping-pong']],
  width: [['mono', 'Mono']],
}

export function createRack(options: RackOptions): RackHandle {
  const sliders = new Map<string, { handle: SliderHandle; module: ModuleId; key: string }>()
  const switches = new Map<string, { handle: SwitchHandle; read: (c: ChainState) => boolean }>()
  const panels = new Map<ModuleId, HTMLElement>()
  const cleanups: Array<() => void> = []

  let chain = options.chain
  let group = options.group
  let eq: EqHandle | null = null
  const patch = options.onPatch

  const tabs = el('div', { class: 'ap-tabs', role: 'tablist' })
  const modules = el('div', { class: 'ap-modules ap-scroll' })
  const root = el('div', { class: 'ap-col', style: 'flex:1 1 auto;min-height:0' }, [tabs, modules])

  function slider(module: ModuleId, key: string, label: string): HTMLElement {
    const spec = paramSpec(module, key)
    const handle = createSlider({
      spec,
      value: readParam(chain, module, key),
      label,
      onInput: (value) => patch({ [module]: { [key]: value } } as Partial<ChainState>),
    })
    sliders.set(`${module}.${key}`, { handle, module, key })
    cleanups.push(() => handle.destroy())
    return handle.el
  }

  function flag(module: ModuleId, key: string, label: string): HTMLElement {
    const handle = createSwitch({
      label,
      on: (chain[module] as unknown as Record<string, boolean>)[key] === true,
      onChange: (on) => patch({ [module]: { [key]: on } } as Partial<ChainState>),
    })
    switches.set(`${module}.${key}`, {
      handle,
      read: (c) => (c[module] as unknown as Record<string, boolean>)[key] === true,
    })
    return el('div', { class: 'ap-row' }, [
      el('span', { class: 'ap-label', style: 'flex:1', text: label }),
      handle.el,
    ])
  }

  function buildModule(id: ModuleId): HTMLElement {
    const reason = options.disabled?.[id]
    const body: Node[] = []

    if (id === 'eq') {
      eq = createEq({
        bands: chain.eq.bands,
        focused: options.eqBand,
        onInput: (bands) => patch({ eq: { on: true, bands } }),
        onFocusBand: options.onFocusBand,
      })
      cleanups.push(() => eq?.destroy())
      body.push(eq.el)
    } else {
      for (const [key, label] of MODULE_PARAMS[id] ?? []) body.push(slider(id, key, label))
      for (const [key, label] of MODULE_FLAGS[id] ?? []) body.push(flag(id, key, label))
    }

    // gain and pan are always on; the rest carry a switch.
    const hasSwitch = typeof (chain[id] as { on?: boolean }).on === 'boolean'
    let power: SwitchHandle | null = null
    if (hasSwitch) {
      power = createSwitch({
        label: `Engage ${MODULE_LABELS[id]}`,
        on: (chain[id] as { on?: boolean }).on === true,
        onChange: (on) => patch({ [id]: { on } } as Partial<ChainState>),
      })
      switches.set(`${id}.on`, {
        handle: power,
        read: (c) => (c[id] as { on?: boolean }).on === true,
      })
    }

    const node = el(
      'div',
      {
        class: 'ap-module',
        'data-span': id === 'eq' ? 'wide' : 'normal',
        'data-on': String(!hasSwitch || (chain[id] as { on?: boolean }).on === true),
      },
      [
        el('div', { class: 'ap-module-head' }, [
          el('span', { class: 'ap-label', text: MODULE_LABELS[id] }),
          power?.el ?? null,
        ]),
        reason
          ? el('div', { class: 'ap-note', text: reason })
          : el('div', { class: 'ap-module-body' }, body),
      ],
    )
    if (reason) node.setAttribute('data-on', 'false')
    panels.set(id, node)
    return node
  }

  function renderTabs(): void {
    tabs.replaceChildren(
      ...MODULE_GROUPS.map((entry) => {
        const active = entry.title === group
        const engaged = entry.modules.filter(
          (id) => (chain[id] as { on?: boolean }).on === true,
        ).length
        const button = el('button', {
          class: 'ap-tab',
          type: 'button',
          role: 'tab',
          'data-on': String(active),
          'aria-selected': String(active),
          onclick: () => {
            group = entry.title
            options.onGroupChange(entry.title)
            renderGroup()
            renderTabs()
          },
        })
        button.append(entry.title)
        if (engaged > 0) button.append(el('sup', { text: String(engaged) }))
        return button
      }),
    )
  }

  function renderGroup(): void {
    // Controls for the outgoing group are discarded; the maps are rebuilt so
    // `update` never writes to a detached node.
    for (const cleanup of cleanups.splice(0)) cleanup()
    sliders.clear()
    switches.clear()
    panels.clear()
    eq = null

    const entry = MODULE_GROUPS.find((g) => g.title === group) ?? MODULE_GROUPS[0]!
    modules.replaceChildren(...entry.modules.map(buildModule))
  }

  renderGroup()
  renderTabs()

  return {
    el: root,
    group: () => group,
    setGroup(title) {
      if (title === group) return
      group = title
      renderGroup()
      renderTabs()
    },
    update(nextChain, eqBand) {
      chain = nextChain
      for (const [, entry] of sliders) {
        entry.handle.set(readParam(chain, entry.module, entry.key))
      }
      for (const [, entry] of switches) entry.handle.set(entry.read(chain))
      eq?.set(chain.eq.bands, eqBand)

      for (const [id, node] of panels) {
        const power = (chain[id] as { on?: boolean }).on
        const enabled = options.disabled?.[id] ? false : power !== false
        node.setAttribute('data-on', String(chain.bypass ? false : enabled))
      }
      renderTabs()
    },
    destroy() {
      for (const cleanup of cleanups) cleanup()
    },
  }
}

/**
 * The module rack: everything you can do to the selected strip.
 *
 * Built once per target and then updated in place. Rebuilding the DOM on every
 * state broadcast would tear a knob out from under the pointer mid-drag, so
 * `update` only pushes values into existing controls; the mixer recreates the
 * rack when the selected strip changes.
 */
import { MODULE_GROUPS, MODULE_LABELS, PARAMS, type ParamSpec } from '../../shared/params.ts'
import type { ChainState, ModuleId } from '../../shared/types.ts'
import { el } from '../core/dom.ts'
import { createKnob, type KnobHandle } from '../controls/knob.ts'
import { createFader, type FaderHandle } from '../controls/fader.ts'
import { createToggle, type ToggleHandle } from '../controls/toggle.ts'
import { createMeter, type MeterHandle } from '../controls/meter.ts'
import { createEq, type EqHandle } from '../controls/eq.ts'
import type { LevelReading } from '../../shared/types.ts'

export type PatchFn = (patch: Partial<ChainState>) => void

export interface RackHandle {
  el: HTMLElement
  update(chain: ChainState, level: LevelReading | undefined, eqBand: number): void
  destroy(): void
}

export interface RackOptions {
  chain: ChainState
  eqBand: number
  /** Modules the current platform or capture mode cannot deliver. */
  disabled?: Partial<Record<ModuleId, string>>
  onPatch: PatchFn
  onFocusBand: (index: number) => void
}

/** Narrow accessor for the flat module/parameter addressing the rack uses. */
function readParam(chain: ChainState, module: ModuleId, key: string): number {
  return (chain[module] as unknown as Record<string, number>)[key] ?? 0
}

function paramSpec(module: ModuleId, key: string): ParamSpec {
  const group = (PARAMS as unknown as Record<string, Record<string, ParamSpec>>)[module]
  const spec = group?.[key]
  if (!spec) throw new Error(`No parameter spec for ${module}.${key}`)
  return spec
}

export function createRack(options: RackOptions): RackHandle {
  const knobs = new Map<string, { handle: KnobHandle; module: ModuleId; key: string }>()
  const toggles = new Map<string, { handle: ToggleHandle; read: (chain: ChainState) => boolean }>()
  const panels = new Map<ModuleId, HTMLElement>()
  const cleanups: Array<() => void> = []

  let chain = options.chain
  const patch = options.onPatch

  // ------------------------------------------------------------- factories

  function knob(module: ModuleId, key: string, label?: string): HTMLElement {
    const spec = paramSpec(module, key)
    const handle = createKnob({
      spec,
      value: readParam(chain, module, key),
      label: label ?? spec.label,
      onInput: (value) => patch({ [module]: { [key]: value } } as Partial<ChainState>),
    })
    knobs.set(`${module}.${key}`, { handle, module, key })
    cleanups.push(() => handle.destroy())
    return handle.el
  }

  function powerToggle(module: ModuleId): ToggleHandle {
    const handle = createToggle({
      label: 'On',
      on: (chain[module] as { on?: boolean }).on === true,
      title: `Engage ${MODULE_LABELS[module]}`,
      onChange: (on) => patch({ [module]: { on } } as Partial<ChainState>),
    })
    toggles.set(`${module}.on`, {
      handle,
      read: (c) => (c[module] as { on?: boolean }).on === true,
    })
    return handle
  }

  function flagToggle(
    module: ModuleId,
    key: string,
    label: string,
    tone: 'lit' | 'bus' | 'hot' = 'lit',
  ): HTMLElement {
    const handle = createToggle({
      label,
      tone,
      on: (chain[module] as unknown as Record<string, boolean>)[key] === true,
      onChange: (on) => patch({ [module]: { [key]: on } } as Partial<ChainState>),
    })
    toggles.set(`${module}.${key}`, {
      handle,
      read: (c) => (c[module] as unknown as Record<string, boolean>)[key] === true,
    })
    return handle.el
  }

  /** A module panel with its legend, power cap and body. */
  function panel(
    module: ModuleId,
    body: Array<Node | null>,
    opts: { power?: boolean; span?: 'wide' | 'double'; extraHead?: Node } = {},
  ): HTMLElement {
    const power = opts.power === false ? null : powerToggle(module)
    const disabledReason = options.disabled?.[module]
    const bodyEl = el('div', { class: 'ap-module-body' }, body.filter(Boolean) as Node[])
    const node = el(
      'div',
      {
        class: 'ap-module',
        'data-span': opts.span ?? 'normal',
        'data-on': String(power ? (chain[module] as { on?: boolean }).on === true : true),
      },
      [
        el('div', { class: 'ap-module-head' }, [
          el('div', { class: 'ap-legend ap-module-title', text: MODULE_LABELS[module] }),
          opts.extraHead ?? null,
          power?.el ?? null,
        ]),
        disabledReason
          ? el('div', { class: 'ap-strip-sub', text: disabledReason })
          : bodyEl,
      ],
    )
    if (disabledReason) node.setAttribute('data-on', 'false')
    panels.set(module, node)
    return node
  }

  // ---------------------------------------------------------------- panels

  const levelFader: FaderHandle = createFader({
    spec: paramSpec('gain', 'level'),
    value: chain.gain.level,
    onInput: (level) => patch({ gain: { level, mute: chain.gain.mute } }),
  })
  cleanups.push(() => levelFader.destroy())

  const meter: MeterHandle = createMeter({ wide: true })

  const muteToggle = createToggle({
    label: 'Mute',
    tone: 'hot',
    on: chain.gain.mute,
    onChange: (mute) => patch({ gain: { level: chain.gain.level, mute } }),
  })
  toggles.set('gain.mute', { handle: muteToggle, read: (c) => c.gain.mute })

  const eq: EqHandle = createEq({
    bands: chain.eq.bands,
    focused: options.eqBand,
    onInput: (bands) => patch({ eq: { on: true, bands } }),
    onFocusBand: options.onFocusBand,
  })
  cleanups.push(() => eq.destroy())

  const builders: Record<ModuleId, () => HTMLElement> = {
    gain: () =>
      panel(
        'gain',
        [
          el('div', { style: 'display:flex;gap:12px;align-items:flex-end' }, [
            levelFader.el,
            meter.el,
          ]),
          el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [
            knob('pan', 'value', 'Pan'),
            muteToggle.el,
          ]),
        ],
        { power: false },
      ),
    pan: () => el('div'), // rendered inside the Level panel
    eq: () => panel('eq', [eq.el], { span: 'double' }),
    tone: () => panel('tone', [knob('tone', 'bass'), knob('tone', 'treble')]),
    filter: () =>
      panel('filter', [
        knob('filter', 'highpass', 'HP'),
        knob('filter', 'lowpass', 'LP'),
        knob('filter', 'resonance', 'Res'),
      ]),
    comp: () =>
      panel(
        'comp',
        [
          knob('comp', 'threshold', 'Thresh'),
          knob('comp', 'ratio'),
          knob('comp', 'attack'),
          knob('comp', 'release'),
          knob('comp', 'knee'),
          knob('comp', 'makeup'),
        ],
        { span: 'double' },
      ),
    limiter: () => panel('limiter', [knob('limiter', 'ceiling'), knob('limiter', 'release')]),
    gate: () =>
      panel(
        'gate',
        [
          knob('gate', 'threshold', 'Thresh'),
          knob('gate', 'attack'),
          knob('gate', 'release'),
          knob('gate', 'floor'),
        ],
        { span: 'double' },
      ),
    reverb: () =>
      panel(
        'reverb',
        [
          knob('reverb', 'mix'),
          knob('reverb', 'size'),
          knob('reverb', 'decay'),
          knob('reverb', 'damping', 'Damp'),
        ],
        { span: 'double' },
      ),
    delay: () =>
      panel(
        'delay',
        [
          knob('delay', 'mix'),
          knob('delay', 'time'),
          knob('delay', 'feedback', 'Fdbk'),
          el('div', { class: 'ap-switches' }, [flagToggle('delay', 'pingPong', 'Ping-pong')]),
        ],
        { span: 'double' },
      ),
    width: () =>
      panel('width', [
        knob('width', 'amount', 'Width'),
        el('div', { class: 'ap-switches' }, [flagToggle('width', 'mono', 'Mono')]),
      ]),
    pitch: () => panel('pitch', [knob('pitch', 'semitones', 'Semitones')]),
    speed: () => panel('speed', [knob('speed', 'rate', 'Rate')]),
  }

  const modules = el('div', { class: 'ap-modules' })
  for (const group of MODULE_GROUPS) {
    for (const id of group.modules) {
      if (id === 'pan') continue // lives in the Level panel
      modules.append(builders[id]())
    }
  }

  const root = el('div', { class: 'ap-desk-inner' }, [modules])

  return {
    el: root,
    update(nextChain, level, eqBand) {
      chain = nextChain
      for (const [, entry] of knobs) {
        entry.handle.set(readParam(chain, entry.module, entry.key))
      }
      for (const [, entry] of toggles) entry.handle.set(entry.read(chain))
      levelFader.set(chain.gain.level)
      meter.set(level)
      eq.set(chain.eq.bands, eqBand)

      for (const [id, node] of panels) {
        const power = (chain[id] as { on?: boolean }).on
        const enabled = options.disabled?.[id] ? false : power !== false
        node.setAttribute('data-on', String(chain.bypass ? false : enabled))
      }
    },
    destroy() {
      for (const cleanup of cleanups) cleanup()
    },
  }
}

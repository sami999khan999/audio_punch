/**
 * Default state, plus the clamp/merge helpers that keep any ChainState
 * reaching the engine or storage structurally valid — whether it came from a
 * UI control, a template patch or an imported JSON file.
 */
import {
  EQ_FREQUENCIES,
  MODULE_IDS,
  SCHEMA_VERSION,
  type ChainState,
  type ModuleId,
  type Settings,
} from './types.ts'
import { PARAMS, clampTo } from './params.ts'

const P = PARAMS

export const DEFAULT_CHAIN: ChainState = {
  bypass: false,
  gain: { level: P.gain.level.default, mute: false },
  pan: { value: P.pan.value.default },
  eq: { on: false, bands: EQ_FREQUENCIES.map(() => 0) },
  tone: { on: false, bass: P.tone.bass.default, treble: P.tone.treble.default },
  filter: {
    on: false,
    highpass: P.filter.highpass.default,
    lowpass: P.filter.lowpass.default,
    resonance: P.filter.resonance.default,
  },
  comp: {
    on: false,
    threshold: P.comp.threshold.default,
    knee: P.comp.knee.default,
    ratio: P.comp.ratio.default,
    attack: P.comp.attack.default,
    release: P.comp.release.default,
    makeup: P.comp.makeup.default,
  },
  limiter: { on: false, ceiling: P.limiter.ceiling.default, release: P.limiter.release.default },
  gate: {
    on: false,
    threshold: P.gate.threshold.default,
    attack: P.gate.attack.default,
    release: P.gate.release.default,
    floor: P.gate.floor.default,
  },
  reverb: {
    on: false,
    mix: P.reverb.mix.default,
    size: P.reverb.size.default,
    decay: P.reverb.decay.default,
    damping: P.reverb.damping.default,
  },
  delay: {
    on: false,
    mix: P.delay.mix.default,
    time: P.delay.time.default,
    feedback: P.delay.feedback.default,
    pingPong: false,
  },
  width: { on: false, amount: P.width.amount.default, mono: false },
  pitch: { on: false, semitones: P.pitch.semitones.default },
  speed: { on: false, rate: P.speed.rate.default },
}

export const DEFAULT_UI = {
  overlayHeight: 560,
  accent: '#ffa72b',
  reduceMotion: false,
  meters: true,
}

/**
 * In-overlay keymap. Accelerators use the KeyboardEvent.key value, optionally
 * prefixed with modifiers, e.g. `Ctrl+1`, `Shift+ArrowUp`.
 * The four browser-level shortcuts live in `manifest.config.ts` instead.
 */
export const DEFAULT_KEYMAP: Record<string, string[]> = {
  'overlay.close': ['Escape'],
  'overlay.help': ['?'],
  'overlay.dashboard': ['Ctrl+d'],
  'strip.next': [']'],
  'strip.prev': ['['],
  'strip.global': ['`'],
  'strip.reset': ['Backspace'],
  'strip.ignoreGlobal': ['i'],
  'strip.arm': ['Enter'],
  'gain.up': ['ArrowUp'],
  'gain.down': ['ArrowDown'],
  'gain.fine.up': ['Shift+ArrowUp'],
  'gain.fine.down': ['Shift+ArrowDown'],
  'gain.mute': ['m'],
  'eq.bandNext': ['ArrowRight'],
  'eq.bandPrev': ['ArrowLeft'],
  'eq.boost': ['Alt+ArrowUp'],
  'eq.cut': ['Alt+ArrowDown'],
  'eq.flat': ['Alt+0'],
  'module.eq': ['e'],
  'module.tone': ['t'],
  'module.filter': ['f'],
  'module.comp': ['c'],
  'module.limiter': ['l'],
  'module.gate': ['g'],
  'module.reverb': ['r'],
  'module.delay': ['d'],
  'module.width': ['w'],
  'module.pitch': ['p'],
  'module.speed': ['s'],
  'chain.bypass': ['b'],
  'global.toggle': ['Ctrl+g'],
  'template.remove': ['Ctrl+0'],
  'template.slot1': ['Ctrl+1'],
  'template.slot2': ['Ctrl+2'],
  'template.slot3': ['Ctrl+3'],
  'template.slot4': ['Ctrl+4'],
  'template.slot5': ['Ctrl+5'],
  'template.slot6': ['Ctrl+6'],
  'template.slot7': ['Ctrl+7'],
  'template.slot8': ['Ctrl+8'],
  'template.slot9': ['Ctrl+9'],
}

export function cloneChain(chain: ChainState): ChainState {
  return structuredClone(chain)
}

export function defaultChain(): ChainState {
  return structuredClone(DEFAULT_CHAIN)
}

/**
 * Merges a (possibly partial) patch over a chain, one module at a time.
 * Module objects are merged shallowly so a patch touching `eq.bands` does not
 * have to restate `eq.on`.
 */
export function mergeChain(base: ChainState, patch: Partial<ChainState>): ChainState {
  const next = cloneChain(base)
  if (typeof patch.bypass === 'boolean') next.bypass = patch.bypass
  for (const id of MODULE_IDS) {
    const incoming = patch[id]
    if (!incoming || typeof incoming !== 'object') continue
    Object.assign(next[id] as object, incoming)
  }
  return clampChain(next)
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Brings any object claiming to be a ChainState into range and into shape.
 * Unknown fields are dropped by construction: we build the result from
 * DEFAULT_CHAIN and only copy fields we know about.
 */
export function clampChain(input: unknown): ChainState {
  const raw = (input ?? {}) as Partial<ChainState>
  const out = defaultChain()

  out.bypass = bool(raw.bypass, false)

  if (raw.gain) {
    out.gain.level = clampTo(raw.gain.level, P.gain.level)
    out.gain.mute = bool(raw.gain.mute, false)
  }
  if (raw.pan) out.pan.value = clampTo(raw.pan.value, P.pan.value)

  if (raw.eq) {
    out.eq.on = bool(raw.eq.on, false)
    const bands = Array.isArray(raw.eq.bands) ? raw.eq.bands : []
    out.eq.bands = EQ_FREQUENCIES.map((_, i) => clampTo(bands[i], P.eq.band))
  }

  if (raw.tone) {
    out.tone.on = bool(raw.tone.on, false)
    out.tone.bass = clampTo(raw.tone.bass, P.tone.bass)
    out.tone.treble = clampTo(raw.tone.treble, P.tone.treble)
  }

  if (raw.filter) {
    out.filter.on = bool(raw.filter.on, false)
    out.filter.highpass = clampTo(raw.filter.highpass, P.filter.highpass)
    out.filter.lowpass = clampTo(raw.filter.lowpass, P.filter.lowpass)
    out.filter.resonance = clampTo(raw.filter.resonance, P.filter.resonance)
    // A highpass above the lowpass would silence the signal entirely.
    if (out.filter.highpass > out.filter.lowpass) {
      out.filter.highpass = P.filter.highpass.default
      out.filter.lowpass = P.filter.lowpass.default
    }
  }

  if (raw.comp) {
    out.comp.on = bool(raw.comp.on, false)
    out.comp.threshold = clampTo(raw.comp.threshold, P.comp.threshold)
    out.comp.knee = clampTo(raw.comp.knee, P.comp.knee)
    out.comp.ratio = clampTo(raw.comp.ratio, P.comp.ratio)
    out.comp.attack = clampTo(raw.comp.attack, P.comp.attack)
    out.comp.release = clampTo(raw.comp.release, P.comp.release)
    out.comp.makeup = clampTo(raw.comp.makeup, P.comp.makeup)
  }

  if (raw.limiter) {
    out.limiter.on = bool(raw.limiter.on, false)
    out.limiter.ceiling = clampTo(raw.limiter.ceiling, P.limiter.ceiling)
    out.limiter.release = clampTo(raw.limiter.release, P.limiter.release)
  }

  if (raw.gate) {
    out.gate.on = bool(raw.gate.on, false)
    out.gate.threshold = clampTo(raw.gate.threshold, P.gate.threshold)
    out.gate.attack = clampTo(raw.gate.attack, P.gate.attack)
    out.gate.release = clampTo(raw.gate.release, P.gate.release)
    out.gate.floor = clampTo(raw.gate.floor, P.gate.floor)
  }

  if (raw.reverb) {
    out.reverb.on = bool(raw.reverb.on, false)
    out.reverb.mix = clampTo(raw.reverb.mix, P.reverb.mix)
    out.reverb.size = clampTo(raw.reverb.size, P.reverb.size)
    out.reverb.decay = clampTo(raw.reverb.decay, P.reverb.decay)
    out.reverb.damping = clampTo(raw.reverb.damping, P.reverb.damping)
  }

  if (raw.delay) {
    out.delay.on = bool(raw.delay.on, false)
    out.delay.mix = clampTo(raw.delay.mix, P.delay.mix)
    out.delay.time = clampTo(raw.delay.time, P.delay.time)
    out.delay.feedback = clampTo(raw.delay.feedback, P.delay.feedback)
    out.delay.pingPong = bool(raw.delay.pingPong, false)
  }

  if (raw.width) {
    out.width.on = bool(raw.width.on, false)
    out.width.amount = clampTo(raw.width.amount, P.width.amount)
    out.width.mono = bool(raw.width.mono, false)
  }

  if (raw.pitch) {
    out.pitch.on = bool(raw.pitch.on, false)
    out.pitch.semitones = clampTo(raw.pitch.semitones, P.pitch.semitones)
  }

  if (raw.speed) {
    out.speed.on = bool(raw.speed.on, false)
    out.speed.rate = clampTo(raw.speed.rate, P.speed.rate)
  }

  return out
}

/** Restricts a chain to the named modules — how a template patch is built. */
export function pickModules(chain: ChainState, modules: ModuleId[]): Partial<ChainState> {
  const patch: Partial<ChainState> = {}
  for (const id of modules) {
    if (!MODULE_IDS.includes(id)) continue
    // Each module is its own object; clone so the template cannot alias state.
    ;(patch as Record<string, unknown>)[id] = structuredClone(chain[id])
  }
  return patch
}

/** True when the chain is doing nothing audible — used to grey out strips. */
export function isChainNeutral(chain: ChainState): boolean {
  if (chain.bypass) return true
  if (chain.gain.mute) return false
  if (chain.gain.level !== 1) return false
  if (chain.pan.value !== 0) return false
  for (const id of MODULE_IDS) {
    const mod = chain[id] as { on?: boolean }
    if (mod && typeof mod.on === 'boolean' && mod.on) return false
  }
  return true
}

export function defaultSettings(): Settings {
  return {
    schema: SCHEMA_VERSION,
    global: { on: false, chain: defaultChain(), snapshot: null },
    sites: {},
    templates: [],
    keymap: structuredClone(DEFAULT_KEYMAP),
    ui: { ...DEFAULT_UI },
    muteAll: false,
    bypassAll: false,
  }
}

/**
 * The modules a chain is actually using — what "save as template" captures by
 * default, so a template does not carry a dozen switched-off modules that
 * would stamp over the target's own settings when applied.
 */
export function engagedModules(chain: ChainState): ModuleId[] {
  const engaged: ModuleId[] = []
  if (chain.gain.level !== DEFAULT_CHAIN.gain.level || chain.gain.mute) engaged.push('gain')
  if (chain.pan.value !== DEFAULT_CHAIN.pan.value) engaged.push('pan')
  for (const id of MODULE_IDS) {
    if (id === 'gain' || id === 'pan') continue
    if ((chain[id] as { on?: boolean }).on === true) engaged.push(id)
  }
  return engaged
}

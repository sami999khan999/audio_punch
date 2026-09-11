/**
 * One description of every numeric parameter in the chain.
 *
 * This table is the only place ranges live. Knobs read their limits from it,
 * `clampChain` enforces them at runtime, and the settings importer validates
 * against it — so a range can never drift between UI, engine and storage.
 */
import type { ModuleId } from './types.ts'

export interface ParamSpec {
  min: number
  max: number
  step: number
  default: number
  unit: string
  label: string
  /**
   * How the value maps to a linear 0..1 control position.
   * 'log' for frequency and ratio style params where linear feels wrong.
   */
  curve: 'lin' | 'log'
}

function spec(
  min: number,
  max: number,
  step: number,
  def: number,
  unit: string,
  label: string,
  curve: 'lin' | 'log' = 'lin',
): ParamSpec {
  return { min, max, step, default: def, unit, label, curve }
}

export const PARAMS = {
  gain: {
    level: spec(0, 6, 0.01, 1, '×', 'Level', 'log'),
  },
  pan: {
    value: spec(-1, 1, 0.01, 0, '', 'Pan'),
  },
  eq: {
    // Every band shares one spec; `bands` is an array of this shape.
    band: spec(-18, 18, 0.5, 0, 'dB', 'Band'),
  },
  tone: {
    bass: spec(-18, 18, 0.5, 0, 'dB', 'Bass'),
    treble: spec(-18, 18, 0.5, 0, 'dB', 'Treble'),
  },
  filter: {
    highpass: spec(20, 20000, 1, 20, 'Hz', 'High-pass', 'log'),
    lowpass: spec(20, 20000, 1, 20000, 'Hz', 'Low-pass', 'log'),
    resonance: spec(0.1, 20, 0.1, 0.7, 'Q', 'Resonance', 'log'),
  },
  comp: {
    threshold: spec(-60, 0, 0.5, -24, 'dB', 'Threshold'),
    knee: spec(0, 40, 0.5, 30, 'dB', 'Knee'),
    ratio: spec(1, 20, 0.1, 4, ':1', 'Ratio', 'log'),
    attack: spec(0, 1, 0.001, 0.003, 's', 'Attack', 'log'),
    release: spec(0, 1, 0.001, 0.25, 's', 'Release', 'log'),
    makeup: spec(0, 24, 0.5, 0, 'dB', 'Make-up'),
  },
  limiter: {
    ceiling: spec(-24, 0, 0.5, -1, 'dB', 'Ceiling'),
    release: spec(0.01, 0.5, 0.005, 0.05, 's', 'Release', 'log'),
  },
  gate: {
    threshold: spec(-80, 0, 1, -50, 'dB', 'Threshold'),
    attack: spec(0.001, 0.2, 0.001, 0.005, 's', 'Attack', 'log'),
    release: spec(0.01, 1, 0.005, 0.15, 's', 'Release', 'log'),
    floor: spec(-80, 0, 1, -80, 'dB', 'Floor'),
  },
  reverb: {
    mix: spec(0, 1, 0.01, 0.25, '', 'Mix'),
    size: spec(0.2, 6, 0.1, 1.8, 's', 'Size'),
    decay: spec(0.1, 8, 0.1, 2.2, '', 'Decay'),
    damping: spec(0, 1, 0.01, 0.4, '', 'Damping'),
  },
  delay: {
    mix: spec(0, 1, 0.01, 0.25, '', 'Mix'),
    time: spec(0.01, 2, 0.01, 0.28, 's', 'Time', 'log'),
    feedback: spec(0, 0.95, 0.01, 0.35, '', 'Feedback'),
  },
  width: {
    amount: spec(0, 2, 0.01, 1, '', 'Width'),
  },
  pitch: {
    semitones: spec(-12, 12, 0.1, 0, 'st', 'Pitch'),
  },
  speed: {
    rate: spec(0.25, 4, 0.05, 1, '×', 'Speed', 'log'),
  },
} as const satisfies Partial<Record<ModuleId, Record<string, ParamSpec>>>

/** Human labels for each module, used by the rack, keymap editor and toasts. */
export const MODULE_LABELS: Record<ModuleId, string> = {
  gain: 'Level',
  pan: 'Pan',
  eq: 'Equaliser',
  tone: 'Tone',
  filter: 'Filter',
  comp: 'Compressor',
  limiter: 'Limiter',
  gate: 'Gate',
  reverb: 'Reverb',
  delay: 'Delay',
  width: 'Stereo',
  pitch: 'Pitch',
  speed: 'Speed',
}

/** Modules grouped the way the rack lays them out. */
export const MODULE_GROUPS: Array<{ title: string; modules: ModuleId[] }> = [
  { title: 'Core', modules: ['gain', 'pan', 'eq', 'tone'] },
  { title: 'Dynamics', modules: ['comp', 'limiter', 'gate'] },
  { title: 'Space', modules: ['reverb', 'delay', 'width'] },
  { title: 'Time', modules: ['filter', 'pitch', 'speed'] },
]

/**
 * True for controls whose printed centre is the resting position — pan, EQ
 * bands, tone shelves, pitch. They light outward from the centre rather than
 * up from the minimum, which is how the hardware reads.
 */
export function isBipolar(s: ParamSpec): boolean {
  return s.min < 0 && s.max > 0 && s.default === 0
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return value < min ? min : value > max ? max : value
}

export function clampTo(value: unknown, s: ParamSpec): number {
  return typeof value === 'number' ? clamp(value, s.min, s.max) : s.default
}

/** Maps a parameter value to a 0..1 control position, honouring its curve. */
export function toPosition(value: number, s: ParamSpec): number {
  const v = clamp(value, s.min, s.max)
  if (s.curve === 'log') {
    // Shift into positive territory so log is defined across the whole range.
    const offset = s.min <= 0 ? 1 - s.min : 0
    const lo = Math.log(s.min + offset)
    const hi = Math.log(s.max + offset)
    return (Math.log(v + offset) - lo) / (hi - lo)
  }
  return (v - s.min) / (s.max - s.min)
}

/** Inverse of `toPosition`. */
export function fromPosition(pos: number, s: ParamSpec): number {
  const p = clamp(pos, 0, 1)
  let value: number
  if (s.curve === 'log') {
    const offset = s.min <= 0 ? 1 - s.min : 0
    const lo = Math.log(s.min + offset)
    const hi = Math.log(s.max + offset)
    value = Math.exp(lo + p * (hi - lo)) - offset
  } else {
    value = s.min + p * (s.max - s.min)
  }
  const snapped = Math.round(value / s.step) * s.step
  return clamp(Number(snapped.toFixed(6)), s.min, s.max)
}

/** Formats a value for the numeric readout next to a control. */
export function formatValue(value: number, s: ParamSpec): string {
  const decimals = s.step >= 1 ? 0 : s.step >= 0.1 ? 1 : s.step >= 0.01 ? 2 : 3
  if (s.unit === 'Hz' && value >= 1000) return `${(value / 1000).toFixed(1)}k${s.unit}`
  const sign = s.unit === 'dB' && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}${s.unit ? ` ${s.unit}` : ''}`
}


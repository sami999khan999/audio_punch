/**
 * Built-in templates, seeded on first run.
 *
 * Each one owns only the modules it actually needs, so applying "Night mode"
 * over a chain leaves that chain's EQ alone unless the preset says otherwise.
 * They are ordinary templates: the user can edit, reorder or delete them.
 */
import { EQ_FREQUENCIES, type ModuleId, type Template } from './types.ts'
import { DEFAULT_CHAIN } from './defaults.ts'

interface PresetDef {
  id: string
  name: string
  description: string
  build: () => Partial<Record<ModuleId, unknown>>
}

/** Builds a 10-entry band array from a sparse map of frequency -> gain. */
function bands(map: Partial<Record<(typeof EQ_FREQUENCIES)[number], number>>): number[] {
  return EQ_FREQUENCIES.map((f) => map[f] ?? 0)
}

const PRESETS: PresetDef[] = [
  {
    id: 'preset-night',
    name: 'Night mode',
    description: 'Squashes the dynamic range so quiet dialogue and loud action sit together.',
    build: () => ({
      comp: { ...DEFAULT_CHAIN.comp, on: true, threshold: -34, ratio: 6, attack: 0.005, release: 0.18, makeup: 6 },
      limiter: { ...DEFAULT_CHAIN.limiter, on: true, ceiling: -2 },
      tone: { ...DEFAULT_CHAIN.tone, on: true, bass: -3, treble: 1.5 },
    }),
  },
  {
    id: 'preset-voice',
    name: 'Voice clarity',
    description: 'Rolls off rumble and lifts presence — for podcasts, lectures and calls.',
    build: () => ({
      filter: { ...DEFAULT_CHAIN.filter, on: true, highpass: 90, lowpass: 20000, resonance: 0.7 },
      eq: { on: true, bands: bands({ 125: -2, 250: -3, 2000: 3, 4000: 4, 8000: 2 }) },
      comp: { ...DEFAULT_CHAIN.comp, on: true, threshold: -26, ratio: 3.5, makeup: 4 },
    }),
  },
  {
    id: 'preset-bass',
    name: 'Bass boost',
    description: 'Weight at the bottom, with a limiter so the boost cannot clip.',
    build: () => ({
      eq: { on: true, bands: bands({ 31: 7, 62: 6, 125: 3.5, 250: 1 }) },
      tone: { ...DEFAULT_CHAIN.tone, on: true, bass: 4, treble: 0 },
      limiter: { ...DEFAULT_CHAIN.limiter, on: true, ceiling: -1 },
    }),
  },
  {
    id: 'preset-wide',
    name: 'Wide & warm',
    description: 'Opens the stereo image and softens the top for long listening.',
    build: () => ({
      width: { ...DEFAULT_CHAIN.width, on: true, amount: 1.45, mono: false },
      reverb: { ...DEFAULT_CHAIN.reverb, on: true, mix: 0.12, size: 1.4, decay: 1.8, damping: 0.6 },
      tone: { ...DEFAULT_CHAIN.tone, on: true, bass: 2, treble: -2 },
    }),
  },
  {
    id: 'preset-focus',
    name: 'Focus',
    description: 'Mono, gently filtered and quiet — background listening that does not pull focus.',
    build: () => ({
      width: { ...DEFAULT_CHAIN.width, on: true, amount: 1, mono: true },
      filter: { ...DEFAULT_CHAIN.filter, on: true, highpass: 120, lowpass: 7000, resonance: 0.7 },
      gain: { level: 0.6, mute: false },
    }),
  },
  {
    id: 'preset-radio',
    name: 'Telephone',
    description: 'A hard band-pass and heavy compression — the classic lo-fi radio effect.',
    build: () => ({
      filter: { ...DEFAULT_CHAIN.filter, on: true, highpass: 400, lowpass: 3000, resonance: 3 },
      comp: { ...DEFAULT_CHAIN.comp, on: true, threshold: -30, ratio: 12, attack: 0.001, release: 0.08, makeup: 9 },
      width: { ...DEFAULT_CHAIN.width, on: true, amount: 1, mono: true },
    }),
  },
  {
    id: 'preset-chipmunk',
    name: 'Chipmunk',
    description: 'Up seven semitones with the tempo untouched. Mostly here to show pitch off.',
    build: () => ({
      pitch: { on: true, semitones: 7 },
    }),
  },
  {
    id: 'preset-slow',
    name: 'Slowed + reverb',
    description: 'Three-quarter speed, dropped a tone, with a long tail.',
    build: () => ({
      speed: { on: true, rate: 0.8 },
      pitch: { on: true, semitones: -2 },
      reverb: { ...DEFAULT_CHAIN.reverb, on: true, mix: 0.34, size: 3.2, decay: 3.4, damping: 0.35 },
    }),
  },
]

export function builtInTemplates(): Template[] {
  const now = Date.now()
  return PRESETS.map((preset, index) => {
    const patch = preset.build()
    return {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      modules: Object.keys(patch) as ModuleId[],
      patch: patch as Template['patch'],
      createdAt: now + index,
      builtIn: true,
    }
  })
}

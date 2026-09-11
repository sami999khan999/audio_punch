/**
 * The data contract shared by all four runtime contexts (service worker,
 * offscreen engine, content script, dashboard). Everything else is built on
 * these shapes, so they are deliberately flat: a flat chain makes partial
 * template patches, per-module bypass and keymap targeting all trivial.
 */

/** ISO third-octave centres for the 10-band graphic EQ. */
export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const

export const MODULE_IDS = [
  'gain',
  'pan',
  'eq',
  'tone',
  'filter',
  'comp',
  'limiter',
  'gate',
  'reverb',
  'delay',
  'width',
  'pitch',
  'speed',
] as const

export type ModuleId = (typeof MODULE_IDS)[number]

export interface GainModule {
  /** Linear multiplier. 1 = unity, 6 = 600% boost. */
  level: number
  mute: boolean
}

export interface PanModule {
  /** -1 hard left, 0 centre, +1 hard right. */
  value: number
}

export interface EqModule {
  on: boolean
  /** One gain in dB per entry of EQ_FREQUENCIES. */
  bands: number[]
}

export interface ToneModule {
  on: boolean
  /** Low shelf, dB. */
  bass: number
  /** High shelf, dB. */
  treble: number
}

export interface FilterModule {
  on: boolean
  /** Highpass corner, Hz. At HP_MIN the highpass is effectively open. */
  highpass: number
  /** Lowpass corner, Hz. At LP_MAX the lowpass is effectively open. */
  lowpass: number
  /** Shared Q for both sweeps. */
  resonance: number
}

export interface CompModule {
  on: boolean
  threshold: number
  knee: number
  ratio: number
  attack: number
  release: number
  /** Post-compressor make-up gain in dB. */
  makeup: number
}

export interface LimiterModule {
  on: boolean
  /** Output ceiling in dB; the limiter is a brick-wall compressor at this point. */
  ceiling: number
  release: number
}

export interface GateModule {
  on: boolean
  /** Gate opens above this level, dB. */
  threshold: number
  attack: number
  release: number
  /** Level the signal drops to when closed, dB. */
  floor: number
}

export interface ReverbModule {
  on: boolean
  /** Wet/dry blend, 0 = dry, 1 = fully wet. */
  mix: number
  /** Impulse length in seconds. */
  size: number
  decay: number
  /** High-frequency damping of the tail, 0 = bright, 1 = dark. */
  damping: number
}

export interface DelayModule {
  on: boolean
  mix: number
  /** Delay time in seconds. */
  time: number
  feedback: number
  pingPong: boolean
}

export interface WidthModule {
  on: boolean
  /** Mid/side ratio. 0 = mono, 1 = unchanged, 2 = doubled side. */
  amount: number
  /** Hard mono fold, overrides `amount`. */
  mono: boolean
}

export interface PitchModule {
  on: boolean
  /** Semitones, independent of tempo. Bypassed entirely at 0. */
  semitones: number
}

export interface SpeedModule {
  on: boolean
  /**
   * Playback rate multiplier. Applied by the content script to media elements,
   * not by the audio graph — see `src/content/media-control.ts`.
   */
  rate: number
}

/** The complete processing state for one target (global, or one site). */
export interface ChainState {
  /** Master bypass: audio passes straight through, all modules unlinked. */
  bypass: boolean
  gain: GainModule
  pan: PanModule
  eq: EqModule
  tone: ToneModule
  filter: FilterModule
  comp: CompModule
  limiter: LimiterModule
  gate: GateModule
  reverb: ReverbModule
  delay: DelayModule
  width: WidthModule
  pitch: PitchModule
  speed: SpeedModule
}

/** A template may own any subset of modules; unowned modules are left alone. */
export interface Template {
  id: string
  name: string
  description: string
  /** Which modules this template writes. Derived from `patch` but stored for clarity. */
  modules: ModuleId[]
  patch: Partial<ChainState>
  createdAt: number
  builtIn: boolean
}

/**
 * Captured when a template is applied, restored when it is removed.
 * One level deep by design: applying a second template overwrites this, so
 * removal always returns to the pre-template state rather than to an
 * intermediate template.
 */
export interface TemplateSnapshot {
  templateId: string
  templateName: string
  previous: ChainState
  appliedAt: number
}

export interface SiteState {
  origin: string
  chain: ChainState
  /** When true this site keeps its own chain even while global is on. */
  ignoreGlobal: boolean
  snapshot: TemplateSnapshot | null
  updatedAt: number
}

export interface GlobalState {
  on: boolean
  chain: ChainState
  snapshot: TemplateSnapshot | null
}

export interface UiPrefs {
  /** Overlay height in CSS pixels. */
  overlayHeight: number
  accent: string
  reduceMotion: boolean
  /** Whether level meters are drawn (they cost a little CPU per armed tab). */
  meters: boolean
}

export const SCHEMA_VERSION = 1

export interface Settings {
  schema: number
  global: GlobalState
  sites: Record<string, SiteState>
  templates: Template[]
  /** Action id -> list of accelerators, e.g. `{ 'gain.up': ['ArrowUp'] }`. */
  keymap: Record<string, string[]>
  ui: UiPrefs
  /** Latched by the mute-all / bypass-all browser commands. */
  muteAll: boolean
  bypassAll: boolean
}

/** Addresses the thing a UI control is editing. */
export type TargetKey = 'global' | `site:${string}`

export function siteTarget(origin: string): TargetKey {
  return `site:${origin}`
}

export function targetOrigin(target: TargetKey): string | null {
  return target === 'global' ? null : target.slice('site:'.length)
}

/** Why a tab cannot currently be processed, if it cannot. */
export type TabBlockReason = 'unsupported-page' | 'drm' | 'capture-failed' | null

export interface TabInfo {
  tabId: number
  windowId: number
  origin: string
  title: string
  favIconUrl: string
  audible: boolean
  /** Capture is live and this tab's audio is flowing through the engine. */
  armed: boolean
  /** True while an arm request is in flight. */
  arming: boolean
  blocked: TabBlockReason
  /** Set when the content script reports <audio>/<video> elements present. */
  hasMediaElements: boolean
  active: boolean
}

export interface LevelReading {
  /** Peak amplitude 0..1 over the last frame. */
  peak: number
  /** RMS amplitude 0..1 over the last frame. */
  rms: number
}

/** The full picture every UI surface renders from. */
export interface StateSnapshot {
  settings: Settings
  tabs: TabInfo[]
  /** The tab the requesting UI is running in, if any. */
  selfTabId: number | null
  engineReady: boolean
}

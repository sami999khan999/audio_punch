/**
 * Defaults, and the clamping every value passes through before it is stored or
 * sent to a page.
 */
import {
  MAX_VOLUME,
  MIN_VOLUME,
  SCHEMA_VERSION,
  type AudioState,
  type Settings,
} from './types.ts'

export function clampVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  const clamped = Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, value))
  // Rounded to the step so repeated nudges cannot drift into 1.0000000002.
  return Math.round(clamped * 100) / 100
}

export function defaultAudio(): AudioState {
  return { volume: 1, muted: false }
}

export function defaultSettings(): Settings {
  return {
    schema: SCHEMA_VERSION,
    globalOn: false,
    global: defaultAudio(),
    sites: {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAudio(raw: unknown): AudioState {
  if (!isRecord(raw)) return defaultAudio()
  return { volume: clampVolume(raw.volume), muted: raw.muted === true }
}

/**
 * Brings anything read from storage into shape. Built up from the defaults
 * rather than patched in place, so unknown fields cannot survive.
 */
export function readSettings(raw: unknown): Settings {
  const settings = defaultSettings()
  if (!isRecord(raw)) return settings

  settings.globalOn = raw.globalOn === true
  settings.global = readAudio(raw.global)

  if (isRecord(raw.sites)) {
    for (const [origin, value] of Object.entries(raw.sites)) {
      if (!origin.startsWith('http')) continue
      const audio = readAudio(value)
      settings.sites[origin] = {
        origin,
        volume: audio.volume,
        muted: audio.muted,
        updatedAt: isRecord(value) && typeof value.updatedAt === 'number' ? value.updatedAt : 0,
      }
    }
  }
  return settings
}

/** Formats a gain for display: 1 -> "100%". */
export function formatVolume(volume: number): string {
  return `${Math.round(volume * 100)}%`
}

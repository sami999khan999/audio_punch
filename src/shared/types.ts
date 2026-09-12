/**
 * The whole data model.
 *
 * Volume is a linear gain multiplier: 1 is untouched, values above 1 are a real
 * boost (a Web Audio gain node, not the page's own volume control, which cannot
 * exceed 100%).
 */

export const MIN_VOLUME = 0
export const MAX_VOLUME = 6
/** One press of the up/down shortcut, and one click of +/- in the popup. */
export const VOLUME_STEP = 0.1

export interface AudioState {
  /** Linear gain. 1 = untouched, 6 = 600%. */
  volume: number
  muted: boolean
}

export interface SiteState extends AudioState {
  origin: string
  updatedAt: number
}

export const SCHEMA_VERSION = 1

export interface Settings {
  schema: number
  /** When on, every tab follows `global` and per-site values are left alone. */
  globalOn: boolean
  global: AudioState
  sites: Record<string, SiteState>
}

/** What the popup renders from. */
export interface PopupState {
  settings: Settings
  /** The tab the popup was opened over, if it is one we can act on. */
  origin: string
  title: string
  /** False on pages no content script can run in. */
  supported: boolean
}

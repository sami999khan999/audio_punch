/**
 * The message protocol.
 *
 *   popup  --PopupRequest-->  service worker  --ContentCommand-->  content script
 *   popup  <--PopupState----  service worker
 */
import type { AudioState, PopupState } from './types.ts'

/** Which setting a change applies to. */
export type Scope = 'global' | 'site'

export type PopupRequest =
  | { type: 'popup:hello' }
  | { type: 'popup:set-global-on'; on: boolean }
  | { type: 'popup:set-volume'; scope: Scope; volume: number }
  | { type: 'popup:nudge-volume'; scope: Scope; steps: number }
  | { type: 'popup:set-muted'; scope: Scope; muted: boolean }
  | { type: 'popup:reset'; scope: Scope }

export type PopupResponse = { ok: true; state: PopupState } | { ok: false; error: string }

/** Service worker -> content script. */
export type ContentCommand =
  | { type: 'content:apply'; audio: AudioState }
  /** Read-only probe, so a caller can see what a page is doing without
   *  changing it. Used by the end-to-end test. */
  | { type: 'content:state' }

/** Content script -> service worker, so the worker knows where to push. */
export type ContentReport = { type: 'content:ready'; hasMedia: boolean }

export type ToBackground = PopupRequest | ContentReport

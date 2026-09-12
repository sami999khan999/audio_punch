/**
 * The message protocol.
 *
 *   popup  --PopupRequest-->  service worker  --ContentCommand-->  content script
 *   popup  <--PopupState----  service worker
 */
import type { AudioState, PopupState } from './types.ts'

/** The four things a shortcut can do. Shared by both dispatch paths. */
export type CommandName =
  | 'volume-up'
  | 'volume-down'
  | 'toggle-mute'
  | 'toggle-global'
  | 'reset'

/** One shortcut, as the browser currently has it bound. */
export interface Binding {
  command: CommandName
  /** e.g. "Alt+Shift+Up" — whatever the user has it set to. */
  shortcut: string
}

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
  | {
      type: 'content:apply'
      audio: AudioState
      /** Present when the change came from a shortcut, so the page can show
       *  the new value — in fullscreen there is no popup to look at. */
      announce?: boolean
      /** True when the change applies to every site, for the announcement. */
      global?: boolean
      /**
       * Echoes the `seq` of the keypress this push answers.
       *
       * The page moves its own audio the instant a shortcut is pressed rather
       * than waiting for this message, so by the time a push arrives the page
       * may already be a press or two ahead. Without the echo it would step
       * back to the older value and then forward again — an audible wobble on
       * exactly the fast presses this is all meant to smooth out.
       */
      seq?: number
    }
  /** The live shortcut bindings, so the in-page fallback matches whatever the
   *  user has actually configured rather than the manifest defaults. */
  | { type: 'content:bindings'; bindings: Binding[] }
  /** Read-only probe, so a caller can see what a page is doing without
   *  changing it. Used by the end-to-end test. */
  | { type: 'content:state' }

/** Content script -> service worker. */
export type ContentReport =
  | {
      type: 'content:ready'
      hasMedia: boolean
      /** True when some element cannot be boosted past 100% — see PopupState. */
      capped: boolean
    }
  /**
   * A shortcut caught by the page.
   *
   * The browser restricts keyboard input in fullscreen, so chrome.commands
   * stops firing there — and the toolbar is hidden, so the popup is out of
   * reach too. The content script listens itself while fullscreen and forwards
   * what it catches.
   */
  | {
      type: 'content:command'
      command: CommandName
      /** Counts the presses this page has already applied itself. */
      seq: number
    }

export type ToBackground = PopupRequest | ContentReport

/** Service worker -> popup, so an open popup reflects shortcut changes. */
export type PopupBroadcast = { type: 'popup:changed'; state: PopupState }

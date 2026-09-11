/**
 * The typed message protocol. Every cross-context call in the extension is one
 * of these unions, which is what keeps the service worker, the engine and the
 * two UI surfaces honest about each other's shapes.
 *
 *   UI  (overlay / dashboard)  --UiRequest-->  background  --EngineCommand--> engine
 *   UI  <--Broadcast--         background      <--EngineEvent--               engine
 */
import type {
  Background,
  ChainState,
  LevelReading,
  ModuleId,
  Settings,
  StateSnapshot,
  TargetKey,
  Template,
  UiPrefs,
} from './types.ts'

export const PORT_UI = 'audio-punch:ui'

/** Requests a UI surface sends to the service worker. */
export type UiRequest =
  | { type: 'ui:hello' }
  | { type: 'ui:patch-chain'; target: TargetKey; patch: Partial<ChainState> }
  | { type: 'ui:reset-chain'; target: TargetKey }
  | { type: 'ui:set-global-on'; on: boolean }
  | { type: 'ui:set-ignore-global'; origin: string; value: boolean }
  | { type: 'ui:mute-all'; value?: boolean }
  | { type: 'ui:bypass-all'; value?: boolean }
  | { type: 'ui:save-template'; name: string; description: string; modules: ModuleId[]; source: TargetKey }
  | { type: 'ui:apply-template'; templateId: string; target: TargetKey }
  | { type: 'ui:remove-template'; target: TargetKey }
  | { type: 'ui:delete-template'; templateId: string }
  | { type: 'ui:rename-template'; templateId: string; name: string; description: string }
  | { type: 'ui:reorder-templates'; order: string[] }
  | { type: 'ui:set-ui-prefs'; patch: Partial<UiPrefs> }
  | { type: 'ui:set-keymap'; keymap: Record<string, string[]> }
  | { type: 'ui:forget-site'; origin: string }
  | { type: 'ui:import'; payload: unknown; mode: 'merge' | 'replace' }
  | { type: 'ui:export' }
  | { type: 'ui:open-dashboard' }
  | { type: 'ui:meters'; enabled: boolean }
  | { type: 'ui:get-background' }
  | { type: 'ui:set-background'; background: Background }

/** Replies the service worker sends back to a single request. */
export type UiResponse =
  | {
      ok: true
      snapshot?: StateSnapshot
      settings?: Settings
      template?: Template
      background?: Background
    }
  | { ok: false; error: string }

/** Messages pushed from the service worker to every connected UI. */
export type Broadcast =
  | { type: 'state'; snapshot: StateSnapshot }
  | { type: 'meters'; levels: Record<number, LevelReading> }
  | { type: 'toast'; kind: 'info' | 'warn' | 'error'; text: string }
  | { type: 'background'; background: Background }
  | { type: 'overlay:toggle' }
  | { type: 'overlay:open' }

/**
 * Service worker -> content script.
 *
 * The engine now lives in the content script, so the worker's job is to send
 * each page the chain it resolved for that page's origin.
 */
export type ContentCommand =
  | { type: 'content:toggle-overlay' }
  | { type: 'content:open-overlay' }
  | { type: 'content:close-overlay' }
  | { type: 'content:chain'; chain: ChainState }
  | { type: 'content:set-rate'; rate: number }
  | { type: 'content:probe-media' }
  | { type: 'content:meters'; enabled: boolean }

/** Content script -> service worker (in addition to UiRequest). */
export type ContentReport = {
  type: 'content:report'
  hasMediaElements: boolean
  count: number
  /** Elements routed through the graph. */
  hooked: number
  /** Routed and playing but producing no signal — see TabInfo.silent. */
  silent: boolean
  /** Output level, sent only while a UI is watching. */
  level?: LevelReading
}

export type ToBackground = UiRequest | ContentReport

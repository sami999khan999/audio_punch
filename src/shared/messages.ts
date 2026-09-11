/**
 * The typed message protocol. Every cross-context call in the extension is one
 * of these unions, which is what keeps the service worker, the engine and the
 * two UI surfaces honest about each other's shapes.
 *
 *   UI  (overlay / dashboard)  --UiRequest-->  background  --EngineCommand--> engine
 *   UI  <--Broadcast--         background      <--EngineEvent--               engine
 */
import type {
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
export const PORT_ENGINE = 'audio-punch:engine'

/** Requests a UI surface sends to the service worker. */
export type UiRequest =
  | { type: 'ui:hello' }
  | { type: 'ui:patch-chain'; target: TargetKey; patch: Partial<ChainState> }
  | { type: 'ui:reset-chain'; target: TargetKey }
  | { type: 'ui:set-global-on'; on: boolean }
  | { type: 'ui:set-ignore-global'; origin: string; value: boolean }
  | { type: 'ui:arm'; tabId: number; confirmDrm?: boolean }
  | { type: 'ui:release'; tabId: number }
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

/** Replies the service worker sends back to a single request. */
export type UiResponse =
  | { ok: true; snapshot?: StateSnapshot; settings?: Settings; template?: Template }
  | { ok: false; error: string }

/** Messages pushed from the service worker to every connected UI. */
export type Broadcast =
  | { type: 'state'; snapshot: StateSnapshot }
  | { type: 'meters'; levels: Record<number, LevelReading> }
  | { type: 'toast'; kind: 'info' | 'warn' | 'error'; text: string }
  | { type: 'overlay:toggle' }
  | { type: 'overlay:open' }

/** Service worker -> offscreen engine. */
export type EngineCommand =
  | { type: 'engine:attach'; tabId: number; streamId: string; chain: ChainState }
  | { type: 'engine:detach'; tabId: number }
  | { type: 'engine:detach-all' }
  | { type: 'engine:chain'; tabId: number; chain: ChainState }
  | { type: 'engine:meters'; enabled: boolean }

/** Offscreen engine -> service worker. */
export type EngineEvent =
  | { type: 'engine:ready' }
  | { type: 'engine:attached'; tabId: number }
  | { type: 'engine:error'; tabId: number | null; message: string }
  | { type: 'engine:ended'; tabId: number }
  | { type: 'engine:meters'; levels: Record<number, LevelReading> }

/** Service worker -> content script. */
export type ContentCommand =
  | { type: 'content:toggle-overlay' }
  | { type: 'content:open-overlay' }
  | { type: 'content:close-overlay' }
  | { type: 'content:set-rate'; rate: number }
  | { type: 'content:probe-media' }

/** Content script -> service worker (in addition to UiRequest). */
export type ContentReport = {
  type: 'content:media-report'
  hasMediaElements: boolean
  count: number
}

export type ToBackground = UiRequest | ContentReport

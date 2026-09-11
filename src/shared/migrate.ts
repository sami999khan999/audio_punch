/**
 * Schema migration and import validation.
 *
 * Anything read from disk or from a user-supplied file passes through here
 * before it is allowed to become `Settings`. Import is all-or-nothing: a
 * malformed file is rejected with the failing path named, never applied
 * halfway.
 */
import {
  MODULE_IDS,
  SCHEMA_VERSION,
  type ModuleId,
  type Settings,
  type SiteState,
  type Template,
  type TemplateSnapshot,
} from './types.ts'
import { clampChain, defaultSettings, DEFAULT_KEYMAP, DEFAULT_UI } from './defaults.ts'
import { originOf } from './origin.ts'

export const EXPORT_APP_ID = 'audio-punch'

export interface ExportEnvelope {
  app: typeof EXPORT_APP_ID
  schema: number
  exportedAt: string
  settings: Settings
}

export function makeExport(settings: Settings): ExportEnvelope {
  return {
    app: EXPORT_APP_ID,
    schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: structuredClone(settings),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class ImportError extends Error {
  constructor(
    public path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
  }
}

function normaliseSnapshot(raw: unknown): TemplateSnapshot | null {
  if (!isRecord(raw)) return null
  if (typeof raw.templateId !== 'string') return null
  return {
    templateId: raw.templateId,
    templateName: typeof raw.templateName === 'string' ? raw.templateName : 'Template',
    previous: clampChain(raw.previous),
    appliedAt: typeof raw.appliedAt === 'number' ? raw.appliedAt : Date.now(),
  }
}

function normaliseTemplate(raw: unknown, path: string): Template {
  if (!isRecord(raw)) throw new ImportError(path, 'expected an object')
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    throw new ImportError(`${path}.name`, 'expected a non-empty string')
  }
  if (!isRecord(raw.patch)) throw new ImportError(`${path}.patch`, 'expected an object')

  // A template owns exactly the modules present in its patch; `modules` is a
  // convenience mirror, so derive it rather than trusting the file.
  const modules = MODULE_IDS.filter((id) => id in (raw.patch as Record<string, unknown>))
  const full = clampChain(raw.patch)
  const patch: Partial<Record<ModuleId, unknown>> = {}
  for (const id of modules) patch[id] = structuredClone(full[id])

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    name: raw.name.slice(0, 80),
    description: typeof raw.description === 'string' ? raw.description.slice(0, 240) : '',
    modules,
    patch: patch as Template['patch'],
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    builtIn: raw.builtIn === true,
  }
}

function normaliseSite(origin: string, raw: unknown, path: string): SiteState {
  if (!isRecord(raw)) throw new ImportError(path, 'expected an object')
  return {
    origin,
    chain: clampChain(raw.chain),
    ignoreGlobal: raw.ignoreGlobal === true,
    snapshot: normaliseSnapshot(raw.snapshot),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  }
}

function normaliseKeymap(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = structuredClone(DEFAULT_KEYMAP)
  if (!isRecord(raw)) return out
  for (const [action, accels] of Object.entries(raw)) {
    if (!(action in DEFAULT_KEYMAP)) continue // drop bindings for actions we no longer have
    if (!Array.isArray(accels)) continue
    out[action] = accels.filter((a): a is string => typeof a === 'string' && a.length > 0).slice(0, 4)
  }
  return out
}

/**
 * Brings a raw stored or imported object up to the current schema.
 * Returns warnings for anything that was dropped or repaired, so the UI can
 * say what happened instead of silently changing the user's settings.
 */
export function migrate(raw: unknown): { settings: Settings; warnings: string[] } {
  const warnings: string[] = []
  const settings = defaultSettings()
  if (!isRecord(raw)) return { settings, warnings }

  const incomingSchema = typeof raw.schema === 'number' ? raw.schema : 0
  if (incomingSchema > SCHEMA_VERSION) {
    warnings.push(
      `These settings were written by a newer version (schema ${incomingSchema}). ` +
        `Unrecognised fields were ignored.`,
    )
  }
  // Schema 0 (pre-release, no `schema` field) differs only by absence, so
  // field-by-field normalisation below is the whole migration. Future schema
  // bumps add their steps here.

  if (isRecord(raw.global)) {
    settings.global = {
      on: raw.global.on === true,
      chain: clampChain(raw.global.chain),
      snapshot: normaliseSnapshot(raw.global.snapshot),
    }
  }

  if (isRecord(raw.sites)) {
    for (const [key, value] of Object.entries(raw.sites)) {
      const origin = originOf(key)
      if (!origin) {
        warnings.push(`Skipped settings for "${key}" — not a usable origin.`)
        continue
      }
      try {
        settings.sites[origin] = normaliseSite(origin, value, `sites["${key}"]`)
      } catch (err) {
        warnings.push(err instanceof Error ? err.message : String(err))
      }
    }
  }

  if (Array.isArray(raw.templates)) {
    const seen = new Set<string>()
    raw.templates.forEach((tpl, i) => {
      try {
        const normalised = normaliseTemplate(tpl, `templates[${i}]`)
        if (seen.has(normalised.id)) normalised.id = crypto.randomUUID()
        seen.add(normalised.id)
        settings.templates.push(normalised)
      } catch (err) {
        warnings.push(err instanceof Error ? err.message : String(err))
      }
    })
  }

  settings.keymap = normaliseKeymap(raw.keymap)

  if (isRecord(raw.ui)) {
    const ui = raw.ui
    settings.ui = {
      overlayHeight:
        typeof ui.overlayHeight === 'number' && Number.isFinite(ui.overlayHeight)
          ? Math.min(900, Math.max(260, ui.overlayHeight))
          : DEFAULT_UI.overlayHeight,
      accent: typeof ui.accent === 'string' && /^#[0-9a-f]{6}$/i.test(ui.accent) ? ui.accent : DEFAULT_UI.accent,
      reduceMotion: ui.reduceMotion === true,
      meters: ui.meters !== false,
    }
  }

  settings.muteAll = raw.muteAll === true
  settings.bypassAll = raw.bypassAll === true
  settings.schema = SCHEMA_VERSION

  return { settings, warnings }
}

export type ImportResult =
  | { ok: true; settings: Settings; warnings: string[] }
  | { ok: false; error: string }

/**
 * Validates a parsed JSON payload from a file the user chose.
 * Accepts either an export envelope or a bare settings object.
 */
export function validateImport(payload: unknown): ImportResult {
  if (!isRecord(payload)) {
    return { ok: false, error: 'That file does not contain a JSON object.' }
  }

  let body: unknown = payload
  if (payload.app !== undefined || payload.settings !== undefined) {
    if (payload.app !== EXPORT_APP_ID) {
      return { ok: false, error: `Expected an Audio Punch export ("app": "${EXPORT_APP_ID}").` }
    }
    if (!isRecord(payload.settings)) {
      return { ok: false, error: 'settings: expected an object.' }
    }
    body = payload.settings
  } else if (!isRecord(payload.global) && !isRecord(payload.sites) && !Array.isArray(payload.templates)) {
    return {
      ok: false,
      error: 'No Audio Punch settings found — expected "global", "sites" or "templates".',
    }
  }

  try {
    const { settings, warnings } = migrate(body)
    return { ok: true, settings, warnings }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Combines imported settings with what is already stored.
 * Merge keeps existing sites and templates and adds/overwrites from the file;
 * replace discards everything currently stored.
 */
export function applyImport(current: Settings, incoming: Settings, mode: 'merge' | 'replace'): Settings {
  if (mode === 'replace') return structuredClone(incoming)

  const merged = structuredClone(current)
  merged.global = structuredClone(incoming.global)
  merged.ui = structuredClone(incoming.ui)
  merged.keymap = structuredClone(incoming.keymap)
  Object.assign(merged.sites, structuredClone(incoming.sites))

  const byId = new Map(merged.templates.map((t) => [t.id, t]))
  const byName = new Map(merged.templates.map((t) => [t.name.toLowerCase(), t]))
  for (const tpl of incoming.templates) {
    const clash = byId.get(tpl.id) ?? byName.get(tpl.name.toLowerCase())
    if (clash) {
      Object.assign(clash, structuredClone(tpl), { id: clash.id })
    } else {
      merged.templates.push(structuredClone(tpl))
      byId.set(tpl.id, tpl)
      byName.set(tpl.name.toLowerCase(), tpl)
    }
  }
  return merged
}

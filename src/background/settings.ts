/**
 * The settings store: the single source of truth for the whole extension.
 *
 * Writes are debounced because knob drags produce a change per animation
 * frame, and chrome.storage has a write-rate quota. Every mutation goes
 * through `update()` so there is exactly one place that persists and notifies.
 */
import {
  clampChain,
  cloneChain,
  defaultChain,
  defaultSettings,
  mergeChain,
  pickModules,
} from '../shared/defaults.ts'
import { migrate } from '../shared/migrate.ts'
import { builtInTemplates } from '../shared/presets.ts'
import {
  targetOrigin,
  type ChainState,
  type ModuleId,
  type Settings,
  type SiteState,
  type TargetKey,
  type Template,
} from '../shared/types.ts'
import type { Platform } from '../platform/index.ts'

const STORAGE_KEY = 'audio-punch:settings'
const WRITE_DEBOUNCE_MS = 250

type Listener = (settings: Settings) => void

export class SettingsStore {
  private settings: Settings = defaultSettings()
  private readonly listeners = new Set<Listener>()
  private writeTimer: ReturnType<typeof setTimeout> | null = null
  private loaded = false

  constructor(private readonly platform: Platform) {}

  async load(): Promise<Settings> {
    if (this.loaded) return this.settings
    const raw = await this.platform.storage.read<unknown>(STORAGE_KEY)
    const { settings } = migrate(raw)
    this.settings = settings

    // Seed the built-in templates on first run only. A user who deletes one
    // should not find it back the next time the worker starts.
    if (raw === null) {
      this.settings.templates = builtInTemplates()
      this.flush()
    }
    this.loaded = true
    return this.settings
  }

  current(): Settings {
    return this.settings
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Applies a mutation, schedules a write and notifies every listener. */
  update(mutate: (settings: Settings) => void): Settings {
    mutate(this.settings)
    this.schedule()
    for (const listener of this.listeners) listener(this.settings)
    return this.settings
  }

  private schedule(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      void this.flush()
    }, WRITE_DEBOUNCE_MS)
  }

  /** Forces an immediate write — used before the worker may be suspended. */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    await this.platform.storage.write(STORAGE_KEY, this.settings)
  }

  replaceAll(settings: Settings): Settings {
    return this.update((current) => {
      Object.assign(current, structuredClone(settings))
    })
  }

  // ---------------------------------------------------------------- targets

  /** Returns the site record for an origin, creating it on first write. */
  private siteFor(settings: Settings, origin: string): SiteState {
    let site = settings.sites[origin]
    if (!site) {
      site = {
        origin,
        chain: defaultChain(),
        ignoreGlobal: false,
        snapshot: null,
        updatedAt: Date.now(),
      }
      settings.sites[origin] = site
    }
    return site
  }

  chainFor(target: TargetKey): ChainState {
    const origin = targetOrigin(target)
    if (origin === null) return this.settings.global.chain
    return this.settings.sites[origin]?.chain ?? defaultChain()
  }

  patchChain(target: TargetKey, patch: Partial<ChainState>): Settings {
    return this.update((settings) => {
      const origin = targetOrigin(target)
      if (origin === null) {
        settings.global.chain = mergeChain(settings.global.chain, patch)
      } else {
        const site = this.siteFor(settings, origin)
        site.chain = mergeChain(site.chain, patch)
        site.updatedAt = Date.now()
      }
    })
  }

  resetChain(target: TargetKey): Settings {
    return this.update((settings) => {
      const origin = targetOrigin(target)
      if (origin === null) {
        settings.global.chain = defaultChain()
        settings.global.snapshot = null
      } else {
        const site = this.siteFor(settings, origin)
        site.chain = defaultChain()
        site.snapshot = null
        site.updatedAt = Date.now()
      }
    })
  }

  setIgnoreGlobal(origin: string, value: boolean): Settings {
    return this.update((settings) => {
      const site = this.siteFor(settings, origin)
      site.ignoreGlobal = value
      site.updatedAt = Date.now()
    })
  }

  forgetSite(origin: string): Settings {
    return this.update((settings) => {
      delete settings.sites[origin]
    })
  }

  // -------------------------------------------------------------- templates

  saveTemplate(name: string, description: string, modules: ModuleId[], source: TargetKey): Template {
    const chain = this.chainFor(source)
    const template: Template = {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, 80) || 'Untitled',
      description: description.trim().slice(0, 240),
      modules: [...modules],
      patch: pickModules(chain, modules),
      createdAt: Date.now(),
      builtIn: false,
    }
    this.update((settings) => {
      settings.templates.push(template)
    })
    return template
  }

  /**
   * Applying snapshots the target's current chain first. One level deep by
   * design: applying a second template overwrites the snapshot, so removing
   * always returns to the state before any template was applied rather than
   * to an intermediate one.
   */
  applyTemplate(templateId: string, target: TargetKey): Settings {
    const template = this.settings.templates.find((t) => t.id === templateId)
    if (!template) throw new Error('That template no longer exists.')

    return this.update((settings) => {
      const origin = targetOrigin(target)
      const holder =
        origin === null ? settings.global : this.siteFor(settings, origin)

      // Snapshot the pre-template chain, unless a template is already applied —
      // in which case the existing snapshot is the pre-template state and must
      // be preserved.
      const previous = holder.snapshot?.previous ?? cloneChain(holder.chain)
      holder.chain = mergeChain(holder.chain, template.patch)
      holder.snapshot = {
        templateId: template.id,
        templateName: template.name,
        previous,
        appliedAt: Date.now(),
      }
      if ('updatedAt' in holder) holder.updatedAt = Date.now()
    })
  }

  removeTemplate(target: TargetKey): Settings {
    return this.update((settings) => {
      const origin = targetOrigin(target)
      const holder = origin === null ? settings.global : settings.sites[origin]
      if (!holder?.snapshot) return
      holder.chain = clampChain(holder.snapshot.previous)
      holder.snapshot = null
      if ('updatedAt' in holder) holder.updatedAt = Date.now()
    })
  }

  deleteTemplate(templateId: string): Settings {
    return this.update((settings) => {
      settings.templates = settings.templates.filter((t) => t.id !== templateId)
      // A target still pointing at the deleted template keeps its sound but
      // loses the "remove" affordance, so fold the snapshot away too.
      const holders = [settings.global, ...Object.values(settings.sites)]
      for (const holder of holders) {
        if (holder.snapshot?.templateId === templateId) holder.snapshot = null
      }
    })
  }

  renameTemplate(templateId: string, name: string, description: string): Settings {
    return this.update((settings) => {
      const template = settings.templates.find((t) => t.id === templateId)
      if (!template) return
      template.name = name.trim().slice(0, 80) || template.name
      template.description = description.trim().slice(0, 240)
    })
  }

  reorderTemplates(order: string[]): Settings {
    return this.update((settings) => {
      const rank = new Map(order.map((id, i) => [id, i]))
      settings.templates.sort(
        (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      )
    })
  }

  /** Template slots 1..9, as bound by the in-overlay shortcuts. */
  templateAt(index: number): Template | undefined {
    return this.settings.templates[index]
  }
}

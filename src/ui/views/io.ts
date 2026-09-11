/**
 * Settings: saved sites, appearance, and moving settings in and out as JSON.
 *
 * Import shows what it found before it changes anything, and asks whether to
 * merge or replace. Silently overwriting a set of carefully tuned sites
 * because a file was dropped on the page would be unforgivable.
 */
import { makeExport } from '../../shared/migrate.ts'
import { prettyOrigin } from '../../shared/origin.ts'
import { DEFAULT_UI } from '../../shared/defaults.ts'
import { isChainNeutral } from '../../shared/defaults.ts'
import { el } from '../core/dom.ts'
import { createButton, createToggle } from '../controls/toggle.ts'
import type { UiState, UiStore } from '../core/store.ts'

export interface SettingsViewHandle {
  el: HTMLElement
  update(state: UiState): void
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 10)
}

export function createSettingsView(store: UiStore): SettingsViewHandle {
  let state = store.get()
  let pending: { settings: unknown; summary: string } | null = null

  const siteList = el('div', { class: 'ap-list' })
  const importStatus = el('div', { class: 'ap-row-sub', style: 'white-space:normal' })
  const importActions = el('div', { style: 'display:none;gap:6px;margin-top:10px' })

  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: 'display:none',
    onchange: (event: Event) => {
      const input = event.target as HTMLInputElement
      const file = input.files?.[0]
      if (file) void readFile(file)
      input.value = ''
    },
  }) as HTMLInputElement

  async function readFile(file: File): Promise<void> {
    try {
      const text = await file.text()
      const payload: unknown = JSON.parse(text)
      const body = (payload as { settings?: unknown })?.settings ?? payload
      const counts = summarise(body)
      pending = { settings: payload, summary: counts }
      importStatus.textContent = `Ready to import from ${file.name}: ${counts}`
      importStatus.style.color = 'var(--ap-ink)'
      importActions.style.display = 'flex'
    } catch (err) {
      pending = null
      importActions.style.display = 'none'
      importStatus.style.color = 'var(--ap-hot)'
      importStatus.textContent = `Could not read that file: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  function summarise(body: unknown): string {
    const record = (body ?? {}) as Record<string, unknown>
    const sites = typeof record.sites === 'object' && record.sites ? Object.keys(record.sites).length : 0
    const templates = Array.isArray(record.templates) ? record.templates.length : 0
    const parts = [
      `${sites} site${sites === 1 ? '' : 's'}`,
      `${templates} template${templates === 1 ? '' : 's'}`,
    ]
    if (record.global) parts.push('a global chain')
    return parts.join(', ')
  }

  async function runImport(mode: 'merge' | 'replace'): Promise<void> {
    if (!pending) return
    const response = await store.send({ type: 'ui:import', payload: pending.settings, mode })
    if (!response.ok) {
      importStatus.style.color = 'var(--ap-hot)'
      importStatus.textContent = response.error
      return
    }
    pending = null
    importActions.style.display = 'none'
    importStatus.style.color = 'var(--ap-ink-faint)'
    importStatus.textContent = 'Imported.'
  }

  function exportSettings(): void {
    const envelope = makeExport(state.snapshot.settings)
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = el('a', { href: url, download: `audio-punch-${timestamp()}.json` })
    link.click()
    // Revoking immediately can cancel the download in some builds; one frame
    // is enough for it to have started.
    requestAnimationFrame(() => URL.revokeObjectURL(url))
  }

  importActions.replaceChildren(
    createButton({ label: 'Merge', title: 'Keep what is here and add from the file', onClick: () => void runImport('merge') }),
    createButton({ label: 'Replace everything', tone: 'hot', onClick: () => void runImport('replace') }),
    createButton({
      label: 'Cancel',
      onClick: () => {
        pending = null
        importActions.style.display = 'none'
        importStatus.textContent = ''
      },
    }),
  )

  const metersToggle = createToggle({
    label: 'Meters',
    on: DEFAULT_UI.meters,
    title: 'Draw level meters (costs a little CPU per captured tab)',
    onChange: (meters) => void store.send({ type: 'ui:set-ui-prefs', patch: { meters } }),
  })

  const motionToggle = createToggle({
    label: 'Reduce motion',
    on: DEFAULT_UI.reduceMotion,
    onChange: (reduceMotion) => void store.send({ type: 'ui:set-ui-prefs', patch: { reduceMotion } }),
  })

  const accentInput = el('input', {
    type: 'color',
    class: 'ap-input',
    style: 'width:52px;padding:2px;height:28px',
    'aria-label': 'Indicator colour',
    oninput: (event: Event) => {
      const accent = (event.target as HTMLInputElement).value
      void store.send({ type: 'ui:set-ui-prefs', patch: { accent } })
    },
  }) as HTMLInputElement

  const root = el('div', { class: 'ap-section' }, [
    el('div', {}, [
      el('div', { class: 'ap-card', style: 'margin-bottom:14px' }, [
        el('div', { class: 'ap-legend', style: 'margin-bottom:10px', text: 'Backup' }),
        el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
          createButton({ label: 'Export…', onClick: exportSettings }),
          createButton({ label: 'Import…', onClick: () => fileInput.click() }),
        ]),
        fileInput,
        el('div', { style: 'margin-top:10px' }, [importStatus]),
        importActions,
      ]),
      el('div', { class: 'ap-card' }, [
        el('div', { class: 'ap-legend', style: 'margin-bottom:10px', text: 'Appearance' }),
        el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
          metersToggle.el,
          motionToggle.el,
          accentInput,
        ]),
      ]),
    ]),
    el('div', {}, [
      el('div', { class: 'ap-legend', style: 'margin-bottom:8px', text: 'Saved sites' }),
      siteList,
    ]),
  ])

  function renderSites(): void {
    const { sites, global } = state.snapshot.settings
    const origins = Object.keys(sites).sort()

    if (origins.length === 0) {
      siteList.replaceChildren(
        el('div', { class: 'ap-strip-sub', style: 'white-space:normal;padding:8px 2px' }, [
          'Nothing saved yet. Adjust a tab in the mixer and it will appear here.',
        ]),
      )
      return
    }

    siteList.replaceChildren(
      ...origins.map((origin) => {
        const site = sites[origin]!
        const following = global.on && !site.ignoreGlobal
        const pin = createToggle({
          label: 'Pin',
          on: site.ignoreGlobal,
          title: 'Keep this site on its own chain even while global is on',
          onChange: (value) => void store.send({ type: 'ui:set-ignore-global', origin, value }),
        })
        return el('div', { class: 'ap-row' }, [
          el('div', { class: 'ap-row-main' }, [
            el('div', { class: 'ap-row-title', text: prettyOrigin(origin) }),
            el('div', {
              class: 'ap-row-sub',
              text: [
                isChainNeutral(site.chain) ? 'Flat' : 'Has a chain',
                site.snapshot ? `Template: ${site.snapshot.templateName}` : null,
                following ? 'Following global' : null,
              ]
                .filter(Boolean)
                .join(' · '),
            }),
          ]),
          pin.el,
          createButton({
            label: 'Forget',
            tone: 'hot',
            onClick: () => void store.send({ type: 'ui:forget-site', origin }),
          }),
        ])
      }),
    )
  }

  return {
    el: root,
    update(next) {
      state = next
      const { ui } = state.snapshot.settings
      metersToggle.set(ui.meters)
      motionToggle.set(ui.reduceMotion)
      if (accentInput.value !== ui.accent) accentInput.value = ui.accent
      renderSites()
    },
  }
}

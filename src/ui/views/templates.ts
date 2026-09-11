/**
 * Template library.
 *
 * A template owns only the modules it lists, so applying one leaves everything
 * else on the target alone. The editor shows exactly which modules that is —
 * without it, "apply" is a guess about what will change.
 */
import { MODULE_LABELS } from '../../shared/params.ts'
import { MODULE_IDS, type TargetKey, type Template } from '../../shared/types.ts'
import { prettyOrigin } from '../../shared/origin.ts'
import { el } from '../core/dom.ts'
import { createButton } from '../controls/toggle.ts'
import type { UiState, UiStore } from '../core/store.ts'

export interface TemplatesHandle {
  el: HTMLElement
  update(state: UiState): void
}

export function createTemplatesView(store: UiStore): TemplatesHandle {
  let selectedId: string | null = null
  let state = store.get()

  const list = el('div', { class: 'ap-list' })
  const detail = el('div', { class: 'ap-card' })

  const root = el('div', { class: 'ap-section' }, [
    el('div', {}, [
      el('div', { class: 'ap-legend', style: 'margin-bottom:8px', text: 'Templates' }),
      list,
      el('div', {
        class: 'ap-strip-sub',
        style: 'white-space:normal;padding:10px 2px',
        text: 'Slots 1–9 are bound to Ctrl+1 through Ctrl+9 in the mixer, in this order.',
      }),
    ]),
    detail,
  ])

  function selected(): Template | undefined {
    return state.snapshot.settings.templates.find((t) => t.id === selectedId)
  }

  function targetOptions(): Array<{ value: TargetKey; label: string }> {
    const seen = new Set<string>()
    const options: Array<{ value: TargetKey; label: string }> = [
      { value: 'global', label: 'Global' },
    ]
    for (const tab of state.snapshot.tabs) {
      if (!tab.origin || seen.has(tab.origin)) continue
      seen.add(tab.origin)
      options.push({ value: `site:${tab.origin}`, label: prettyOrigin(tab.origin) })
    }
    for (const origin of Object.keys(state.snapshot.settings.sites)) {
      if (seen.has(origin)) continue
      seen.add(origin)
      options.push({ value: `site:${origin}`, label: prettyOrigin(origin) })
    }
    return options
  }

  function renderList(): void {
    const templates = state.snapshot.settings.templates
    if (templates.length === 0) {
      list.replaceChildren(
        el('div', { class: 'ap-strip-sub', style: 'white-space:normal;padding:8px 2px' }, [
          'No templates yet. Set a chain up in the mixer and use "Save as…".',
        ]),
      )
      return
    }

    list.replaceChildren(
      ...templates.map((template, index) =>
        el(
          'div',
          {
            class: 'ap-row',
            'data-selected': String(template.id === selectedId),
            onclick: () => {
              selectedId = template.id
              render()
            },
          },
          [
            el('span', { class: 'ap-readout', style: 'color:var(--ap-ink-faint)', text: index < 9 ? `${index + 1}` : '·' }),
            el('div', { class: 'ap-row-main' }, [
              el('div', { class: 'ap-row-title', text: template.name }),
              el('div', {
                class: 'ap-row-sub',
                text: template.modules.map((id) => MODULE_LABELS[id]).join(' · ') || 'Empty',
              }),
            ]),
            createButton({
              label: '↑',
              icon: true,
              title: 'Move up',
              onClick: () => move(template.id, -1),
            }),
            createButton({
              label: '↓',
              icon: true,
              title: 'Move down',
              onClick: () => move(template.id, 1),
            }),
          ],
        ),
      ),
    )
  }

  function move(templateId: string, offset: number): void {
    const order = state.snapshot.settings.templates.map((t) => t.id)
    const index = order.indexOf(templateId)
    const next = index + offset
    if (index < 0 || next < 0 || next >= order.length) return
    order.splice(next, 0, ...order.splice(index, 1))
    void store.send({ type: 'ui:reorder-templates', order })
  }

  function renderDetail(): void {
    const template = selected()
    if (!template) {
      detail.replaceChildren(
        el('div', { class: 'ap-empty' }, [
          el('strong', { text: 'Pick a template' }),
          el('span', { text: 'Choose one on the left to rename it, see what it changes, or apply it to a site.' }),
        ]),
      )
      return
    }

    const nameInput = el('input', {
      class: 'ap-input',
      value: template.name,
      'aria-label': 'Template name',
    }) as HTMLInputElement
    const descInput = el('textarea', {
      class: 'ap-input',
      'aria-label': 'Template description',
    }) as HTMLTextAreaElement
    descInput.value = template.description

    const targetSelect = el('select', { class: 'ap-input', 'aria-label': 'Apply to' }) as HTMLSelectElement
    targetSelect.replaceChildren(
      ...targetOptions().map((option) => el('option', { value: option.value, text: option.label })),
    )

    const moduleList = el(
      'div',
      { class: 'ap-checks' },
      MODULE_IDS.filter((id) => id !== 'pan').map((id) =>
        el('label', { class: 'ap-check' }, [
          el('input', {
            type: 'checkbox',
            checked: template.modules.includes(id),
            disabled: true,
          }),
          el('span', { text: MODULE_LABELS[id] }),
        ]),
      ),
    )

    detail.replaceChildren(
      el('div', { class: 'ap-field' }, [
        el('span', { class: 'ap-legend', text: 'Name' }),
        nameInput,
      ]),
      el('div', { class: 'ap-field' }, [
        el('span', { class: 'ap-legend', text: 'What it is for' }),
        descInput,
      ]),
      el('div', { style: 'display:flex;gap:6px;margin-bottom:16px' }, [
        createButton({
          label: 'Save changes',
          onClick: () => {
            void store.send({
              type: 'ui:rename-template',
              templateId: template.id,
              name: nameInput.value,
              description: descInput.value,
            })
          },
        }),
        createButton({
          label: 'Delete',
          tone: 'hot',
          onClick: () => {
            void store.send({ type: 'ui:delete-template', templateId: template.id })
            selectedId = null
          },
        }),
      ]),
      el('div', { class: 'ap-field' }, [
        el('span', { class: 'ap-legend', text: 'Modules it writes' }),
        moduleList,
        el('div', {
          class: 'ap-row-sub',
          style: 'margin-top:6px',
          text: 'Everything else on the target is left as it is.',
        }),
      ]),
      el('div', { class: 'ap-field' }, [
        el('span', { class: 'ap-legend', text: 'Apply to' }),
        el('div', { style: 'display:flex;gap:6px' }, [
          targetSelect,
          createButton({
            label: 'Apply',
            onClick: () => {
              void store.send({
                type: 'ui:apply-template',
                templateId: template.id,
                target: targetSelect.value as TargetKey,
              })
            },
          }),
          createButton({
            label: 'Remove',
            title: 'Restore what the target had before a template was applied',
            onClick: () => {
              void store.send({
                type: 'ui:remove-template',
                target: targetSelect.value as TargetKey,
              })
            },
          }),
        ]),
      ]),
    )
  }

  function render(): void {
    renderList()
    renderDetail()
  }

  return {
    el: root,
    update(next) {
      state = next
      const templates = state.snapshot.settings.templates
      if (selectedId && !templates.some((t) => t.id === selectedId)) selectedId = null
      if (!selectedId && templates.length > 0) selectedId = templates[0]!.id
      render()
    },
  }
}

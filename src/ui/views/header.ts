/**
 * The top rail: what you are editing, and the controls that act on everything.
 *
 * Template handling here is deliberately the quick path — apply, remove, and
 * save what is currently engaged under a name. Editing a template's contents,
 * reordering and deleting live in the dashboard, where there is room to show
 * what each one actually contains.
 */
import { engagedModules } from '../../shared/defaults.ts'
import { prettyOrigin } from '../../shared/origin.ts'
import type { ChainState, TargetKey, Template } from '../../shared/types.ts'
import { el } from '../core/dom.ts'
import { createButton, createToggle, type ToggleHandle } from '../controls/toggle.ts'
import type { UiState } from '../core/store.ts'

export interface HeaderHandle {
  el: HTMLElement
  update(state: UiState, chain: ChainState): void
}

export interface HeaderOptions {
  showClose: boolean
  /** The dashboard carries its own wordmark, so its rail omits this one. */
  showWordmark?: boolean
  onApplyTemplate: (templateId: string) => void
  onRemoveTemplate: () => void
  onSaveTemplate: (name: string) => void
  onBypassAll: (on: boolean) => void
  onMuteAll: (on: boolean) => void
  onReset: () => void
  onHelp: () => void
  onDashboard: () => void
  onClose: () => void
}

function targetLabel(target: TargetKey, state: UiState): string {
  if (target === 'global') return 'Global'
  const origin = target.slice('site:'.length)
  const tab = state.snapshot.tabs.find((t) => t.origin === origin)
  return tab?.title || prettyOrigin(origin)
}

export function createHeader(options: HeaderOptions): HeaderHandle {
  const targetName = el('div', {
    class: 'ap-legend',
    style: 'color:var(--ap-ink);letter-spacing:0.12em',
  })

  const templateSelect = el('select', {
    class: 'ap-input',
    style: 'width:auto;height:24px;font-size:11px',
    'aria-label': 'Apply a template',
    onchange: (event: Event) => {
      const select = event.target as HTMLSelectElement
      if (select.value) options.onApplyTemplate(select.value)
    },
  })

  const removeBtn = createButton({
    label: 'Remove',
    title: 'Remove the applied template and restore the previous settings',
    onClick: options.onRemoveTemplate,
  })
  removeBtn.hidden = true

  // Inline save form rather than a prompt(): prompt is blocked inside sandboxed
  // frames and looks like the page's own dialog, which is the last thing an
  // overlay on someone else's site should do.
  const nameInput = el('input', {
    class: 'ap-input',
    style: 'width:150px;height:24px;font-size:11px',
    placeholder: 'Template name',
    'aria-label': 'Template name',
    onkeydown: (event: Event) => {
      const key = (event as KeyboardEvent).key
      event.stopPropagation()
      if (key === 'Enter') submitSave()
      if (key === 'Escape') toggleSave(false)
    },
  }) as HTMLInputElement

  const saveForm = el('div', { style: 'display:none;align-items:center;gap:6px' }, [
    nameInput,
    createButton({ label: 'Save', onClick: () => submitSave() }),
  ])

  const saveBtn = createButton({
    label: 'Save as…',
    title: 'Save the engaged modules as a reusable template',
    onClick: () => toggleSave(saveForm.style.display === 'none'),
  })

  function toggleSave(show: boolean): void {
    saveForm.style.display = show ? 'flex' : 'none'
    saveBtn.hidden = show
    if (show) nameInput.focus()
    else nameInput.value = ''
  }

  function submitSave(): void {
    const name = nameInput.value.trim()
    if (!name) {
      nameInput.focus()
      return
    }
    options.onSaveTemplate(name)
    toggleSave(false)
  }

  const bypassCap: ToggleHandle = createToggle({
    label: 'Bypass',
    tone: 'hot',
    on: false,
    title: 'Pass every tab through untouched',
    onChange: options.onBypassAll,
  })

  const muteCap: ToggleHandle = createToggle({
    label: 'Mute all',
    tone: 'hot',
    on: false,
    title: 'Silence every captured tab',
    onChange: options.onMuteAll,
  })

  const engagedNote = el('div', { class: 'ap-legend' })

  const root = el('div', { class: 'ap-rail' }, [
    options.showWordmark === false
      ? null
      : el('div', { class: 'ap-wordmark' }, ['Audio', el('span', { text: 'Punch' })]),
    options.showWordmark === false
      ? null
      : el('div', { style: 'width:1px;height:18px;background:var(--ap-line)' }),
    el('div', { class: 'ap-legend', text: 'Editing' }),
    targetName,
    engagedNote,
    el('div', { class: 'ap-rail-spacer' }),
    templateSelect,
    removeBtn,
    saveBtn,
    saveForm,
    bypassCap.el,
    muteCap.el,
    createButton({ label: '?', icon: true, title: 'Keyboard shortcuts', onClick: options.onHelp }),
    createButton({
      label: '⤢',
      icon: true,
      title: 'Open the full mixing desk',
      onClick: options.onDashboard,
    }),
    options.showClose
      ? createButton({ label: '✕', icon: true, title: 'Close (Esc)', onClick: options.onClose })
      : null,
  ])

  let renderedTemplates = ''

  function renderTemplates(templates: Template[], appliedId: string | null): void {
    const signature = `${templates.map((t) => `${t.id}:${t.name}`).join('|')}::${appliedId}`
    if (signature === renderedTemplates) return
    renderedTemplates = signature

    templateSelect.replaceChildren(
      el('option', { value: '', text: appliedId ? 'Change template…' : 'Apply template…' }),
      ...templates.map((t) =>
        el('option', { value: t.id, text: t.name, selected: t.id === appliedId }),
      ),
    )
    templateSelect.value = appliedId ?? ''
  }

  return {
    el: root,
    update(state, chain) {
      const { settings } = state.snapshot
      const holder =
        state.target === 'global'
          ? settings.global
          : settings.sites[state.target.slice('site:'.length)]

      targetName.textContent = targetLabel(state.target, state)
      renderTemplates(settings.templates, holder?.snapshot?.templateId ?? null)
      removeBtn.hidden = !holder?.snapshot
      removeBtn.title = holder?.snapshot
        ? `Remove "${holder.snapshot.templateName}" and restore what was there before`
        : ''

      const count = engagedModules(chain).length
      engagedNote.textContent = count === 0 ? 'Flat' : `${count} engaged`

      bypassCap.set(settings.bypassAll)
      muteCap.set(settings.muteAll)
    },
  }
}

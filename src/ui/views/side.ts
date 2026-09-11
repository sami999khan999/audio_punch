/**
 * The right-hand column: the backdrop picker and the template shelf.
 *
 * These are the two things you reach for between listening sessions rather
 * than mid-adjustment, which is why they sit beside the mixer rather than in it.
 */
import { engagedModules } from '../../shared/defaults.ts'
import type { Background, TargetKey } from '../../shared/types.ts'
import { el } from '../core/dom.ts'
import { createPill } from '../controls/switch.ts'
import { createSlider } from '../controls/slider.ts'
import type { ParamSpec } from '../../shared/params.ts'
import type { UiState, UiStore } from '../core/store.ts'

export interface SideHandle {
  el: HTMLElement
  update(state: UiState): void
}

/** chrome.storage is unlimited here, but a 200MB video would still stall. */
const MAX_BYTES = 80 * 1024 * 1024

/** Backdrop legibility controls. Their own specs rather than a borrowed one,
 *  so changing a DSP range cannot quietly move them. */
const DIM_SPEC: ParamSpec = {
  min: 0, max: 0.9, step: 0.01, default: 0.45, unit: '', label: 'Dim', curve: 'lin',
}
const BLUR_SPEC: ParamSpec = {
  min: 0, max: 40, step: 1, default: 0, unit: 'px', label: 'Blur', curve: 'lin',
}

export function createSide(store: UiStore, currentTarget: () => TargetKey): SideHandle {
  let state = store.get()

  // ── backdrop ───────────────────────────────────────────────────────────
  const fileInput = el('input', {
    type: 'file',
    accept: 'image/*,video/*',
    style: 'display:none',
    onchange: (event: Event) => {
      const input = event.target as HTMLInputElement
      const file = input.files?.[0]
      if (file) void loadBackground(file)
      input.value = ''
    },
  }) as HTMLInputElement

  const status = el('div', { class: 'ap-note' })
  const swatches = el('div', { class: 'ap-bg-grid' })

  async function loadBackground(file: File): Promise<void> {
    if (file.size > MAX_BYTES) {
      status.textContent = `That file is ${(file.size / 1048576).toFixed(0)}MB. Keep it under ${MAX_BYTES / 1048576}MB.`
      return
    }
    const kind = file.type.startsWith('video/') ? 'video' : 'image'
    status.textContent = 'Reading…'
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read that file.'))
        reader.readAsDataURL(file)
      })
      const background: Background = { kind, dataUrl, name: file.name, updatedAt: Date.now() }
      const response = await store.send({ type: 'ui:set-background', background })
      status.textContent = response.ok ? '' : response.error
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err)
    }
  }

  function renderSwatches(): void {
    const background = state.background
    const has = background.kind !== 'none'
    swatches.replaceChildren(
      el(
        'button',
        {
          class: 'ap-bg-swatch',
          type: 'button',
          title: has ? background.name : 'No backdrop',
          'data-on': String(has),
          onclick: () => fileInput.click(),
        },
        [
          has && background.kind === 'image'
            ? el('img', { src: background.dataUrl, alt: '' })
            : has
              ? el('video', { src: background.dataUrl, muted: true, playsinline: true })
              : '—',
        ],
      ),
      el('button', {
        class: 'ap-bg-swatch',
        type: 'button',
        text: '+',
        title: 'Choose an image or video',
        onclick: () => fileInput.click(),
      }),
      el('button', {
        class: 'ap-bg-swatch',
        type: 'button',
        text: '⌫',
        title: 'Remove the backdrop',
        onclick: () => {
          void store.send({
            type: 'ui:set-background',
            background: { kind: 'none', dataUrl: '', name: '', updatedAt: Date.now() },
          })
        },
      }),
    )
  }

  const dimSlider = createSlider({
    spec: DIM_SPEC,
    value: state.snapshot.settings.ui.backgroundDim,
    label: 'Dim',
    onInput: (backgroundDim) => void store.send({ type: 'ui:set-ui-prefs', patch: { backgroundDim } }),
  })
  const blurSlider = createSlider({
    spec: BLUR_SPEC,
    value: state.snapshot.settings.ui.backgroundBlur,
    label: 'Blur',
    onInput: (backgroundBlur) => void store.send({ type: 'ui:set-ui-prefs', patch: { backgroundBlur } }),
  })

  const backdropCard = el('div', { class: 'ap-glass ap-card' }, [
    el('div', { class: 'ap-row', style: 'margin-bottom:10px' }, [
      el('span', { class: 'ap-label', style: 'flex:1', text: 'Backdrop' }),
    ]),
    swatches,
    fileInput,
    el('div', { style: 'height:10px' }),
    dimSlider.el,
    blurSlider.el,
    status,
  ])

  // ── templates ──────────────────────────────────────────────────────────
  const templateShelf = el('div', { class: 'ap-wrap' })
  const nameInput = el('input', {
    class: 'ap-input',
    placeholder: 'Save current as…',
    'aria-label': 'Template name',
    onkeydown: (event: Event) => {
      event.stopPropagation()
      if ((event as KeyboardEvent).key === 'Enter') save()
    },
  }) as HTMLInputElement

  function save(): void {
    const name = nameInput.value.trim()
    if (!name) {
      nameInput.focus()
      return
    }
    const target = currentTarget()
    const settings = state.snapshot.settings
    const chain =
      target === 'global'
        ? settings.global.chain
        : (settings.sites[target.slice('site:'.length)]?.chain ?? settings.global.chain)
    void store.send({
      type: 'ui:save-template',
      name,
      description: '',
      modules: engagedModules(chain),
      source: target,
    })
    nameInput.value = ''
  }

  const removeBtn = createPill({
    label: 'Remove template',
    title: 'Restore what was here before the template',
    onClick: () => void store.send({ type: 'ui:remove-template', target: currentTarget() }),
  })

  const templateCard = el('div', { class: 'ap-glass ap-card' }, [
    el('div', { class: 'ap-row', style: 'margin-bottom:10px' }, [
      el('span', { class: 'ap-label', style: 'flex:1', text: 'Templates' }),
    ]),
    templateShelf,
    el('div', { style: 'height:10px' }),
    el('div', { class: 'ap-row' }, [nameInput]),
    el('div', { style: 'height:8px' }),
    removeBtn.el,
  ])

  let renderedTemplates = ''

  function renderTemplates(): void {
    const { templates } = state.snapshot.settings
    const target = currentTarget()
    const holder =
      target === 'global'
        ? state.snapshot.settings.global
        : state.snapshot.settings.sites[target.slice('site:'.length)]
    const appliedId = holder?.snapshot?.templateId ?? null

    const signature = `${templates.map((t) => `${t.id}:${t.name}`).join('|')}::${appliedId}`
    if (signature === renderedTemplates) return
    renderedTemplates = signature

    templateShelf.replaceChildren(
      ...templates.slice(0, 12).map((template, index) => {
        const pill = createPill({
          label: template.name,
          on: template.id === appliedId,
          title:
            index < 9
              ? `${template.description || template.name} — Ctrl+${index + 1}`
              : template.description || template.name,
          onClick: () =>
            void store.send({
              type: 'ui:apply-template',
              templateId: template.id,
              target: currentTarget(),
            }),
        })
        return pill.el
      }),
    )
    removeBtn.el.hidden = !appliedId
  }

  const root = el('div', { class: 'ap-col ap-col-side ap-scroll' }, [backdropCard, templateCard])

  return {
    el: root,
    update(next) {
      state = next
      renderSwatches()
      renderTemplates()
      dimSlider.set(state.snapshot.settings.ui.backgroundDim)
      blurSlider.set(state.snapshot.settings.ui.backgroundBlur)
    },
  }
}

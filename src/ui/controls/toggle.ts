/**
 * Backlit switch cap — the module on/off and latched controls.
 */
import { el } from '../core/dom.ts'

export interface ToggleHandle {
  el: HTMLButtonElement
  set(on: boolean): void
}

export interface ToggleOptions {
  label: string
  on: boolean
  tone?: 'lit' | 'bus' | 'hot'
  title?: string
  onChange: (on: boolean) => void
}

export function createToggle(options: ToggleOptions): ToggleHandle {
  let on = options.on
  const button = el('button', {
    class: 'ap-cap',
    type: 'button',
    text: options.label,
    'data-on': String(on),
    'data-tone': options.tone ?? 'lit',
    'aria-pressed': String(on),
    title: options.title ?? options.label,
    onclick: (event: Event) => {
      event.stopPropagation()
      on = !on
      apply()
      options.onChange(on)
    },
  })

  function apply(): void {
    button.setAttribute('data-on', String(on))
    button.setAttribute('aria-pressed', String(on))
  }

  return {
    el: button,
    set(next: boolean) {
      if (next === on) return
      on = next
      apply()
    },
  }
}

export interface ButtonOptions {
  label: string
  tone?: 'lit' | 'bus' | 'hot'
  icon?: boolean
  title?: string
  onClick: () => void
}

export function createButton(options: ButtonOptions) {
  return el('button', {
    class: options.icon ? 'ap-btn ap-btn-icon' : 'ap-btn',
    type: 'button',
    text: options.label,
    'data-tone': options.tone ?? 'lit',
    title: options.title ?? options.label,
    onclick: (event: Event) => {
      event.stopPropagation()
      options.onClick()
    },
  })
}

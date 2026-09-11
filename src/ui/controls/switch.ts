/**
 * Toggle switch and pill button.
 */
import { el } from '../core/dom.ts'

export interface SwitchHandle {
  el: HTMLButtonElement
  set(on: boolean): void
}

export function createSwitch(options: {
  on: boolean
  label: string
  onChange: (on: boolean) => void
}): SwitchHandle {
  let on = options.on
  const button = el('button', {
    class: 'ap-switch',
    type: 'button',
    role: 'switch',
    'data-on': String(on),
    'aria-checked': String(on),
    'aria-label': options.label,
    title: options.label,
    onclick: (event: Event) => {
      event.stopPropagation()
      on = !on
      apply()
      options.onChange(on)
    },
  })

  function apply(): void {
    button.setAttribute('data-on', String(on))
    button.setAttribute('aria-checked', String(on))
  }

  return {
    el: button,
    set(next) {
      if (next === on) return
      on = next
      apply()
    },
  }
}

export interface PillHandle {
  el: HTMLButtonElement
  set(on: boolean): void
}

export function createPill(options: {
  label: string
  on?: boolean
  tone?: 'plain' | 'hot'
  title?: string
  onClick: () => void
}): PillHandle {
  let on = options.on === true
  const button = el('button', {
    class: 'ap-pill',
    type: 'button',
    text: options.label,
    'data-on': String(on),
    'data-tone': options.tone ?? 'plain',
    title: options.title ?? options.label,
    onclick: (event: Event) => {
      event.stopPropagation()
      options.onClick()
    },
  })
  return {
    el: button,
    set(next) {
      on = next
      button.setAttribute('data-on', String(on))
    },
  }
}

export function createIconButton(options: {
  icon: string
  title: string
  on?: boolean
  onClick: () => void
}): PillHandle {
  const button = el('button', {
    class: 'ap-icon-btn',
    type: 'button',
    text: options.icon,
    title: options.title,
    'aria-label': options.title,
    'data-on': String(options.on === true),
    onclick: (event: Event) => {
      event.stopPropagation()
      options.onClick()
    },
  })
  return {
    el: button,
    set(next) {
      button.setAttribute('data-on', String(next))
    },
  }
}

/**
 * Convenience for the dashboard's many one-shot buttons: a pill that returns
 * its element directly, since nothing there needs to toggle it later.
 */
export function createPillEl(options: {
  label: string
  tone?: 'plain' | 'hot'
  title?: string
  icon?: boolean
  onClick: () => void
}): HTMLButtonElement {
  return createPill(options).el
}

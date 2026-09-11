/**
 * Horizontal slider — the one continuous control in the interface.
 *
 * It replaces the rotary knobs and vertical faders of the previous design.
 * A slider states its value by length, which reads correctly at a glance over
 * a photographic backdrop; a knob's indicator line does not.
 */
import { formatValue, fromPosition, toPosition, type ParamSpec } from '../../shared/params.ts'
import { el, onDrag } from '../core/dom.ts'

export interface SliderHandle {
  el: HTMLElement
  set(value: number): void
  destroy(): void
}

export interface SliderOptions {
  spec: ParamSpec
  value: number
  /** Omit for a bare track, as used inside the compact source tiles. */
  label?: string
  tone?: 'plain' | 'accent'
  onInput: (value: number) => void
}

export function createSlider(options: SliderOptions): SliderHandle {
  const { spec } = options
  let value = options.value

  const fill = el('div', { class: 'ap-slider-fill' })
  const knob = el('div', { class: 'ap-slider-knob' })
  const track = el(
    'div',
    {
      class: 'ap-slider',
      'data-tone': options.tone ?? 'plain',
      role: 'slider',
      tabindex: '0',
      'aria-label': options.label ?? spec.label,
      'aria-valuemin': String(spec.min),
      'aria-valuemax': String(spec.max),
    },
    [fill, knob],
  )

  const readout = el('span', { class: 'ap-num ap-tile-val' })
  const head = options.label
    ? el('div', { class: 'ap-param-head' }, [
        el('span', { class: 'ap-label', text: options.label }),
        readout,
      ])
    : null
  const root = options.label
    ? el('div', { class: 'ap-param' }, [head, track])
    : track

  function render(): void {
    const position = toPosition(value, spec)
    fill.style.width = `${position * 100}%`
    knob.style.left = `${position * 100}%`
    readout.textContent = formatValue(value, spec)
    track.setAttribute('aria-valuenow', String(value))
    track.setAttribute('aria-valuetext', formatValue(value, spec))
  }

  function commit(next: number): void {
    if (next === value) return
    value = next
    render()
    options.onInput(value)
  }

  function valueAt(clientX: number): number {
    const rect = track.getBoundingClientRect()
    return fromPosition((clientX - rect.left) / Math.max(1, rect.width), spec)
  }

  const stopDrag = onDrag(track, {
    onStart: (event) => {
      track.setAttribute('data-active', 'true')
      commit(valueAt(event.clientX))
    },
    onMove: (_delta, event) => commit(valueAt(event.clientX)),
    onEnd: () => track.removeAttribute('data-active'),
  })

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 1 : 4
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      commit(fromPosition(toPosition(value, spec) + step / 100, spec))
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      commit(fromPosition(toPosition(value, spec) - step / 100, spec))
    } else if (event.key === 'Home') {
      commit(spec.default)
    } else {
      return
    }
    event.preventDefault()
    event.stopPropagation()
  }
  /** Double-click returns a control to its printed centre, as a detent would. */
  const onDoubleClick = () => commit(spec.default)

  track.addEventListener('keydown', onKeyDown)
  track.addEventListener('dblclick', onDoubleClick)
  render()

  return {
    el: root,
    set(next) {
      if (next === value) return
      value = next
      render()
    },
    destroy() {
      stopDrag()
      track.removeEventListener('keydown', onKeyDown)
      track.removeEventListener('dblclick', onDoubleClick)
    },
  }
}

/**
 * Vertical master level, with the output meter drawn inside the track so level
 * and signal share one place on screen.
 */
export interface VSliderHandle {
  el: HTMLElement
  set(value: number): void
  setLevel(peak: number): void
  destroy(): void
}

export function createVSlider(options: {
  spec: ParamSpec
  value: number
  label: string
  onInput: (value: number) => void
}): VSliderHandle {
  const { spec } = options
  let value = options.value

  const fill = el('div', { class: 'ap-vslider-fill' })
  const meter = el('div', { class: 'ap-vslider-meter' })
  const track = el(
    'div',
    {
      class: 'ap-vslider',
      role: 'slider',
      tabindex: '0',
      'aria-label': options.label,
      'aria-valuemin': String(spec.min),
      'aria-valuemax': String(spec.max),
    },
    [fill, meter],
  )

  function render(): void {
    const position = toPosition(value, spec)
    fill.style.height = `${position * 100}%`
    track.setAttribute('aria-valuenow', String(value))
    track.setAttribute('aria-valuetext', formatValue(value, spec))
  }

  function valueAt(clientY: number): number {
    const rect = track.getBoundingClientRect()
    return fromPosition(1 - (clientY - rect.top) / Math.max(1, rect.height), spec)
  }

  function commit(next: number): void {
    if (next === value) return
    value = next
    render()
    options.onInput(value)
  }

  const stopDrag = onDrag(track, {
    onStart: (event) => commit(valueAt(event.clientY)),
    onMove: (_delta, event) => commit(valueAt(event.clientY)),
  })

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 1 : 4
    if (event.key === 'ArrowUp') commit(fromPosition(toPosition(value, spec) + step / 100, spec))
    else if (event.key === 'ArrowDown') commit(fromPosition(toPosition(value, spec) - step / 100, spec))
    else if (event.key === 'Home') commit(spec.default)
    else return
    event.preventDefault()
    event.stopPropagation()
  }
  track.addEventListener('keydown', onKeyDown)
  render()

  return {
    el: track,
    set(next) {
      if (next === value) return
      value = next
      render()
    },
    setLevel(peak) {
      // dB rather than raw amplitude: a linear meter spends most of its travel
      // on levels nobody can hear.
      const db = 20 * Math.log10(Math.max(peak, 1e-4))
      meter.style.height = `${Math.max(0, Math.min(1, (db + 48) / 48)) * 92}%`
    },
    destroy() {
      stopDrag()
      track.removeEventListener('keydown', onKeyDown)
    },
  }
}

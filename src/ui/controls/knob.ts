/**
 * Rotary control.
 *
 * Drawn the way a real potentiometer is marked: a printed arc of ticks that
 * light up to the current position, and a single indicator line on the cap.
 * The lit arc is the readout, so the numeric value only appears while the knob
 * is being touched — the panel stays quiet at rest.
 */
import { formatValue, fromPosition, isBipolar, toPosition, type ParamSpec } from '../../shared/params.ts'
import { el, onDrag, svgEl } from '../core/dom.ts'

const TICKS = 21
const SWEEP = 270
const START = -135
const SIZE = 44
const CENTRE = SIZE / 2

/** Pixels of vertical travel for the full range. */
const TRAVEL = 190
const FINE_TRAVEL = 900

export interface KnobHandle {
  el: HTMLElement
  set(value: number): void
  destroy(): void
}

export interface KnobOptions {
  spec: ParamSpec
  value: number
  label?: string
  tone?: 'lit' | 'bus'
  onInput: (value: number) => void
}

function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { x: CENTRE + radius * Math.sin(rad), y: CENTRE - radius * Math.cos(rad) }
}

export function createKnob(options: KnobOptions): KnobHandle {
  const { spec } = options
  const bipolar = isBipolar(spec)
  let value = options.value

  const ticks: SVGLineElement[] = []
  const tickGroup = svgEl('g')
  for (let i = 0; i < TICKS; i++) {
    const angle = START + (SWEEP * i) / (TICKS - 1)
    const outer = polar(angle, 20)
    const inner = polar(angle, 16.5)
    const tick = svgEl('line', {
      class: 'ap-knob-tick',
      x1: inner.x.toFixed(2),
      y1: inner.y.toFixed(2),
      x2: outer.x.toFixed(2),
      y2: outer.y.toFixed(2),
    })
    ticks.push(tick)
    tickGroup.append(tick)
  }

  const pointer = svgEl('line', { class: 'ap-knob-pointer' })
  const dial = svgEl(
    'svg',
    { class: 'ap-knob-dial', width: SIZE, height: SIZE, viewBox: `0 0 ${SIZE} ${SIZE}`, 'aria-hidden': 'true' },
    [
      tickGroup,
      svgEl('circle', { class: 'ap-knob-body', cx: CENTRE, cy: CENTRE, r: 13 }),
      svgEl('circle', { class: 'ap-knob-cap', cx: CENTRE, cy: CENTRE - 2, r: 10 }),
      pointer,
    ],
  )

  const readout = el('div', { class: 'ap-readout ap-knob-value' })
  const legend = options.label ? el('div', { class: 'ap-legend', text: options.label }) : null

  const root = el(
    'div',
    {
      class: 'ap-knob',
      tabindex: '0',
      role: 'slider',
      'aria-label': options.label ?? spec.label,
      'data-tone': options.tone ?? 'lit',
    },
    [dial, legend, readout],
  )

  let showValue = false

  function render(): void {
    const position = toPosition(value, spec)
    const angle = START + SWEEP * position
    const tip = polar(angle, 11)
    const base = polar(angle, 3)
    pointer.setAttribute('x1', base.x.toFixed(2))
    pointer.setAttribute('y1', base.y.toFixed(2))
    pointer.setAttribute('x2', tip.x.toFixed(2))
    pointer.setAttribute('y2', tip.y.toFixed(2))

    // Bipolar controls light outward from the centre tick; unipolar ones fill
    // up from the minimum.
    const index = Math.round(position * (TICKS - 1))
    const centre = (TICKS - 1) / 2
    const from = bipolar ? Math.min(index, centre) : 0
    const to = bipolar ? Math.max(index, centre) : index
    ticks.forEach((tick, i) => {
      tick.setAttribute('data-lit', String(i >= from && i <= to))
    })

    root.setAttribute('aria-valuenow', String(value))
    root.setAttribute('aria-valuetext', formatValue(value, spec))
    readout.textContent = showValue ? formatValue(value, spec) : ''
  }

  function commit(next: number): void {
    if (next === value) return
    value = next
    render()
    options.onInput(value)
  }

  let dragStart = 0
  const stopDrag = onDrag(root, {
    onStart: () => {
      dragStart = toPosition(value, spec)
      showValue = true
      root.setAttribute('data-active', 'true')
      render()
    },
    onMove: (delta, event) => {
      const travel = event.shiftKey ? FINE_TRAVEL : TRAVEL
      commit(fromPosition(dragStart - delta.y / travel, spec))
    },
    onEnd: () => {
      showValue = false
      root.removeAttribute('data-active')
      render()
    },
  })

  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const direction = event.deltaY > 0 ? -1 : 1
    const steps = event.shiftKey ? 1 : 3
    commit(fromPosition(toPosition(value, spec) + (direction * steps) / 100, spec))
    showValue = true
    render()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const coarse = event.shiftKey ? 1 : 5
    let handled = true
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        commit(fromPosition(toPosition(value, spec) + coarse / 100, spec))
        break
      case 'ArrowDown':
      case 'ArrowLeft':
        commit(fromPosition(toPosition(value, spec) - coarse / 100, spec))
        break
      case 'Home':
        commit(spec.default)
        break
      default:
        handled = false
    }
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
      showValue = true
      render()
    }
  }

  /** Double-click returns a control to its printed centre, as a detent would. */
  const onDoubleClick = () => commit(spec.default)
  const onFocus = () => {
    showValue = true
    render()
  }
  const onBlur = () => {
    showValue = false
    render()
  }

  root.addEventListener('wheel', onWheel, { passive: false })
  root.addEventListener('keydown', onKeyDown)
  root.addEventListener('dblclick', onDoubleClick)
  root.addEventListener('focus', onFocus)
  root.addEventListener('blur', onBlur)

  render()

  return {
    el: root,
    set(next: number) {
      if (next === value) return
      value = next
      render()
    },
    destroy() {
      stopDrag()
      root.removeEventListener('wheel', onWheel)
      root.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('dblclick', onDoubleClick)
      root.removeEventListener('focus', onFocus)
      root.removeEventListener('blur', onBlur)
    },
  }
}

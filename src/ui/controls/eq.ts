/**
 * The equaliser.
 *
 * Curve and band sliders share one x-axis and one column grid, so dragging a
 * slider visibly deforms the curve directly above it. Splitting them into two
 * unrelated widgets — the usual approach — hides the relationship that makes
 * an EQ legible.
 */
import { EQ_FREQUENCIES } from '../../shared/types.ts'
import { PARAMS, clamp, formatValue } from '../../shared/params.ts'
import { el, onDrag, svgEl } from '../core/dom.ts'

const SPEC = PARAMS.eq.band
const VIEW_W = 320
const VIEW_H = 108
const TRACK_HEIGHT = 62
const CAP_HEIGHT = 11
/**
 * Volts-per-pixel for the curve. Drawing the full +/-18dB range would make a
 * typical 4dB move a two-pixel wobble, so the curve is scaled to +/-12dB and
 * clamped — the sliders and the readout carry the exact value.
 */
const CURVE_RANGE_DB = 12
const CURVE_MARGIN = 9

export interface EqHandle {
  el: HTMLElement
  set(bands: number[], focused: number): void
  destroy(): void
}

export interface EqOptions {
  bands: number[]
  focused: number
  onInput: (bands: number[]) => void
  onFocusBand: (index: number) => void
}

function hzLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz)
}

/**
 * A Catmull-Rom spline through the band points, so the curve reads as a smooth
 * response rather than a polyline. Purely presentational — the actual filters
 * are peaking biquads.
 */
function curvePath(bands: number[]): string {
  const count = EQ_FREQUENCIES.length
  const step = VIEW_W / count
  const half = VIEW_H / 2 - CURVE_MARGIN
  const points = bands.slice(0, count).map((gain, i) => ({
    x: step * (i + 0.5),
    y: VIEW_H / 2 - clamp(gain / CURVE_RANGE_DB, -1, 1) * half,
  }))
  if (points.length === 0) return ''

  const first = points[0]!
  const last = points[points.length - 1]!
  let path = `M 0 ${first.y.toFixed(2)} L ${first.x.toFixed(2)} ${first.y.toFixed(2)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(points.length - 1, i + 2)]!
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  path += ` L ${VIEW_W} ${last.y.toFixed(2)}`
  return path
}

export function createEq(options: EqOptions): EqHandle {
  let bands = [...options.bands]
  let focused = options.focused

  const line = svgEl('path', { class: 'ap-eq-line' })
  const fill = svgEl('path', { class: 'ap-eq-fill' })
  const grid = svgEl('g')
  for (const db of [-6, 6]) {
    const y = VIEW_H / 2 - (db / CURVE_RANGE_DB) * (VIEW_H / 2 - CURVE_MARGIN)
    grid.append(svgEl('line', { class: 'ap-eq-grid', x1: 0, y1: y, x2: VIEW_W, y2: y }))
  }
  grid.append(
    svgEl('line', { class: 'ap-eq-zero', x1: 0, y1: VIEW_H / 2, x2: VIEW_W, y2: VIEW_H / 2 }),
  )

  const curve = svgEl(
    'svg',
    {
      class: 'ap-eq-curve',
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
    },
    [grid, fill, line],
  )

  const caps: HTMLElement[] = []
  const bandEls: HTMLElement[] = []
  const cleanups: Array<() => void> = []
  const readout = el('div', { class: 'ap-readout', style: 'text-align:right;min-height:12px' })
  const bandRow = el('div', { class: 'ap-eq-bands' })

  EQ_FREQUENCIES.forEach((hz, index) => {
    const cap = el('div', { class: 'ap-eq-band-cap' })
    const track = el('div', { class: 'ap-eq-band-track' }, [cap])
    const band = el(
      'div',
      {
        class: 'ap-eq-band',
        tabindex: '0',
        role: 'slider',
        'aria-label': `${hzLabel(hz)} hertz`,
        'aria-valuemin': SPEC.min,
        'aria-valuemax': SPEC.max,
      },
      [track, el('div', { class: 'ap-eq-hz', text: hzLabel(hz) })],
    )

    function valueAt(clientY: number): number {
      const rect = track.getBoundingClientRect()
      const usable = rect.height - CAP_HEIGHT
      const local = clamp(clientY - rect.top - CAP_HEIGHT / 2, 0, usable)
      const position = 1 - local / Math.max(1, usable)
      const raw = SPEC.min + position * (SPEC.max - SPEC.min)
      return clamp(Math.round(raw / SPEC.step) * SPEC.step, SPEC.min, SPEC.max)
    }

    function commit(value: number): void {
      if (bands[index] === value) return
      bands = bands.map((g, i) => (i === index ? value : g))
      render()
      options.onInput([...bands])
    }

    cleanups.push(
      onDrag(track, {
        onStart: (event) => {
          focused = index
          options.onFocusBand(index)
          commit(valueAt(event.clientY))
        },
        onMove: (_delta, event) => commit(valueAt(event.clientY)),
      }),
    )

    const onKeyDown = (event: KeyboardEvent) => {
      const amount = event.shiftKey ? SPEC.step : 1
      const current = bands[index] ?? 0
      if (event.key === 'ArrowUp') commit(clamp(current + amount, SPEC.min, SPEC.max))
      else if (event.key === 'ArrowDown') commit(clamp(current - amount, SPEC.min, SPEC.max))
      else if (event.key === 'Home' || event.key === 'Backspace') commit(0)
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    const onFocus = () => {
      focused = index
      options.onFocusBand(index)
      render()
    }
    const onDoubleClick = () => commit(0)

    band.addEventListener('keydown', onKeyDown)
    band.addEventListener('focus', onFocus)
    band.addEventListener('dblclick', onDoubleClick)
    cleanups.push(() => {
      band.removeEventListener('keydown', onKeyDown)
      band.removeEventListener('focus', onFocus)
      band.removeEventListener('dblclick', onDoubleClick)
    })

    caps.push(cap)
    bandEls.push(band)
    bandRow.append(band)
  })

  function render(): void {
    const path = curvePath(bands)
    line.setAttribute('d', path)
    fill.setAttribute('d', `${path} L ${VIEW_W} ${VIEW_H / 2} L 0 ${VIEW_H / 2} Z`)

    bands.forEach((gain, i) => {
      const cap = caps[i]
      const band = bandEls[i]
      if (!cap || !band) return
      const position = (clamp(gain, SPEC.min, SPEC.max) - SPEC.min) / (SPEC.max - SPEC.min)
      cap.style.top = `${(1 - position) * (TRACK_HEIGHT - CAP_HEIGHT)}px`
      band.setAttribute('data-focused', String(i === focused))
      band.setAttribute('aria-valuenow', String(gain))
      band.setAttribute('aria-valuetext', formatValue(gain, SPEC))
    })

    const gain = bands[focused] ?? 0
    readout.textContent = `${hzLabel(EQ_FREQUENCIES[focused] ?? 0)}Hz  ${formatValue(gain, SPEC)}`
  }

  const root = el('div', { class: 'ap-eq' }, [curve, bandRow, readout])
  render()

  return {
    el: root,
    set(nextBands, nextFocused) {
      bands = [...nextBands]
      focused = nextFocused
      render()
    },
    destroy() {
      for (const cleanup of cleanups) cleanup()
    },
  }
}

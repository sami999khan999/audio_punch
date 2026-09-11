/**
 * The equaliser.
 *
 * Curve and band sliders share one x-axis and one column grid, so dragging a
 * band visibly deforms the curve directly above it. Splitting them into two
 * unrelated widgets — the usual approach — hides the relationship that makes an
 * EQ legible.
 *
 * Each band fills from the centre line outwards, so cut and boost are told
 * apart by direction rather than by reading a number.
 */
import { EQ_FREQUENCIES } from '../../shared/types.ts'
import { PARAMS, clamp, formatValue } from '../../shared/params.ts'
import { el, onDrag, svgEl } from '../core/dom.ts'

const SPEC = PARAMS.eq.band
const VIEW_W = 320
const VIEW_H = 84
/**
 * Drawing the full ±18 dB range would make a typical 4 dB move a two-pixel
 * wobble, so the curve is scaled to ±12 dB and clamped. The bands and the
 * readout carry the exact value.
 */
const CURVE_RANGE_DB = 12
const CURVE_MARGIN = 8

export interface EqHandle {
  el: HTMLElement
  set(bands: number[], focused: number): void
  destroy(): void
}

function hzLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz)
}

/** A Catmull-Rom spline through the band points, so the curve reads as a
 *  response rather than a polyline. Presentational only — the filters are
 *  peaking biquads. */
function curvePath(bands: number[]): string {
  const count = EQ_FREQUENCIES.length
  const step = VIEW_W / count
  const half = VIEW_H / 2 - CURVE_MARGIN
  const points = bands.slice(0, count).map((gain, i) => ({
    x: step * (i + 0.5),
    y: VIEW_H / 2 - clamp(gain / CURVE_RANGE_DB, -1, 1) * half,
  }))
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return ''

  let path = `M 0 ${first.y.toFixed(2)} L ${first.x.toFixed(2)} ${first.y.toFixed(2)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(points.length - 1, i + 2)]!
    path +=
      ` C ${(p1.x + (p2.x - p0.x) / 6).toFixed(2)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(2)}` +
      ` ${(p2.x - (p3.x - p1.x) / 6).toFixed(2)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(2)}` +
      ` ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return `${path} L ${VIEW_W} ${last.y.toFixed(2)}`
}

export function createEq(options: {
  bands: number[]
  focused: number
  onInput: (bands: number[]) => void
  onFocusBand: (index: number) => void
}): EqHandle {
  let bands = [...options.bands]
  let focused = options.focused

  const line = svgEl('path', { class: 'ap-eq-line' })
  const fill = svgEl('path', { class: 'ap-eq-fill' })
  const grid = svgEl('g')
  for (const db of [-6, 6]) {
    const y = VIEW_H / 2 - (db / CURVE_RANGE_DB) * (VIEW_H / 2 - CURVE_MARGIN)
    grid.append(svgEl('line', { class: 'ap-eq-grid', x1: 0, y1: y, x2: VIEW_W, y2: y }))
  }
  grid.append(svgEl('line', { class: 'ap-eq-zero', x1: 0, y1: VIEW_H / 2, x2: VIEW_W, y2: VIEW_H / 2 }))

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

  const fills: HTMLElement[] = []
  const bandEls: HTMLElement[] = []
  const cleanups: Array<() => void> = []
  const bandRow = el('div', { class: 'ap-eq-bands' })

  EQ_FREQUENCIES.forEach((hz, index) => {
    const bandFill = el('div', { class: 'ap-eq-band-fill' })
    const track = el('div', { class: 'ap-eq-band-track' }, [bandFill])
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
      const position = 1 - clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1)
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
        onMove: (_d, event) => commit(valueAt(event.clientY)),
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

    fills.push(bandFill)
    bandEls.push(band)
    bandRow.append(band)
  })

  const readout = el('div', { class: 'ap-num', style: 'text-align:right;color:var(--ap-ink-3)' })

  function render(): void {
    const path = curvePath(bands)
    line.setAttribute('d', path)
    fill.setAttribute('d', `${path} L ${VIEW_W} ${VIEW_H / 2} L 0 ${VIEW_H / 2} Z`)

    bands.forEach((gain, i) => {
      const bandFill = fills[i]
      const band = bandEls[i]
      if (!bandFill || !band) return
      // Fill outward from the centre line: up for boost, down for cut, on the
      // same +/-12 dB scale as the curve so the two agree visually.
      const magnitude = Math.min(1, Math.abs(gain) / CURVE_RANGE_DB)
      if (gain >= 0) {
        bandFill.style.top = `${50 - magnitude * 50}%`
        bandFill.style.bottom = '50%'
      } else {
        bandFill.style.top = '50%'
        bandFill.style.bottom = `${50 - magnitude * 50}%`
      }
      band.setAttribute('data-focused', String(i === focused))
      band.setAttribute('aria-valuenow', String(gain))
      band.setAttribute('aria-valuetext', formatValue(gain, SPEC))
    })

    readout.textContent = `${hzLabel(EQ_FREQUENCIES[focused] ?? 0)}Hz  ${formatValue(bands[focused] ?? 0, SPEC)}`
  }

  render()

  return {
    el: el('div', { class: 'ap-eq' }, [curve, bandRow, readout]),
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

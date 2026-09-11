/**
 * Channel fader. Vertical throw, drag or click-to-position, with the cap
 * carrying a lit index line the way a mixer's does.
 */
import { formatValue, fromPosition, toPosition, type ParamSpec } from '../../shared/params.ts'
import { el, onDrag } from '../core/dom.ts'

const TRACK_PADDING = 8
const CAP_HEIGHT = 16

export interface FaderHandle {
  el: HTMLElement
  set(value: number): void
  destroy(): void
}

export interface FaderOptions {
  spec: ParamSpec
  value: number
  label?: string
  onInput: (value: number) => void
}

export function createFader(options: FaderOptions): FaderHandle {
  const { spec } = options
  let value = options.value

  const fill = el('div', { class: 'ap-fader-fill' })
  const cap = el('div', { class: 'ap-fader-cap' })
  const track = el('div', { class: 'ap-fader-track' }, [el('div', { class: 'ap-fader-slot' }), fill, cap])
  const readout = el('div', { class: 'ap-readout' })
  const root = el(
    'div',
    {
      class: 'ap-fader',
      tabindex: '0',
      role: 'slider',
      'aria-label': options.label ?? spec.label,
    },
    [track, readout, options.label ? el('div', { class: 'ap-legend', text: options.label }) : null],
  )

  function travel(): number {
    return Math.max(1, track.clientHeight - TRACK_PADDING * 2 - CAP_HEIGHT)
  }

  function render(): void {
    const position = toPosition(value, spec)
    const offset = TRACK_PADDING + (1 - position) * travel()
    cap.style.top = `${offset}px`
    fill.style.height = `${Math.max(0, track.clientHeight - offset - CAP_HEIGHT / 2 - TRACK_PADDING)}px`
    readout.textContent = formatValue(value, spec)
    root.setAttribute('aria-valuenow', String(value))
    root.setAttribute('aria-valuetext', formatValue(value, spec))
  }

  function commit(next: number): void {
    if (next === value) return
    value = next
    render()
    options.onInput(value)
  }

  /** Maps a pointer y within the track to a value. */
  function valueAt(clientY: number): number {
    const rect = track.getBoundingClientRect()
    const usable = rect.height - TRACK_PADDING * 2 - CAP_HEIGHT
    const local = clientY - rect.top - TRACK_PADDING - CAP_HEIGHT / 2
    return fromPosition(1 - local / Math.max(1, usable), spec)
  }

  let startValue = value
  const stopDrag = onDrag(track, {
    onStart: (event) => {
      // Clicking the track jumps the cap there, then drags from that point —
      // the same behaviour as grabbing the cap itself.
      startValue = valueAt(event.clientY)
      commit(startValue)
    },
    onMove: (delta) => {
      commit(fromPosition(toPosition(startValue, spec) - delta.y / travel(), spec))
    },
  })

  const onKeyDown = (event: KeyboardEvent) => {
    const amount = event.shiftKey ? 1 : 4
    if (event.key === 'ArrowUp') commit(fromPosition(toPosition(value, spec) + amount / 100, spec))
    else if (event.key === 'ArrowDown') commit(fromPosition(toPosition(value, spec) - amount / 100, spec))
    else if (event.key === 'Home') commit(spec.default)
    else return
    event.preventDefault()
    event.stopPropagation()
  }
  const onDoubleClick = () => commit(spec.default)

  root.addEventListener('keydown', onKeyDown)
  track.addEventListener('dblclick', onDoubleClick)

  // The first render needs a laid-out track to measure.
  requestAnimationFrame(render)
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
      root.removeEventListener('keydown', onKeyDown)
      track.removeEventListener('dblclick', onDoubleClick)
    },
  }
}

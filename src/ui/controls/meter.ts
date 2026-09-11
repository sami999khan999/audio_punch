/**
 * LED ladder meter.
 *
 * Segments rather than a continuous bar: a ladder reads at a glance at strip
 * size, and the top two segments turning red is the clip warning without
 * needing a separate indicator.
 */
import { el } from '../core/dom.ts'
import type { LevelReading } from '../../shared/types.ts'

const SEGMENTS = 10
/** Segments from the top that light red instead of tungsten. */
const HOT_SEGMENTS = 2

export interface MeterHandle {
  el: HTMLElement
  set(reading: LevelReading | undefined): void
}

export function createMeter(options: { wide?: boolean } = {}): MeterHandle {
  const segments: HTMLElement[] = []
  const root = el('div', {
    class: 'ap-meter',
    'data-wide': options.wide ? 'true' : 'false',
    role: 'img',
    'aria-label': 'Output level',
  })

  for (let i = 0; i < SEGMENTS; i++) {
    const segment = el('div', {
      class: 'ap-meter-seg',
      'data-zone': i >= SEGMENTS - HOT_SEGMENTS ? 'hot' : 'normal',
    })
    segments.push(segment)
    root.append(segment)
  }

  return {
    el: root,
    set(reading) {
      // Metering on a dB scale rather than linear amplitude: a linear meter
      // spends most of its travel on levels nobody can hear.
      const amplitude = reading?.peak ?? 0
      const db = 20 * Math.log10(Math.max(amplitude, 1e-4))
      const normalised = Math.max(0, Math.min(1, (db + 48) / 48))
      const lit = Math.round(normalised * SEGMENTS)
      for (let i = 0; i < SEGMENTS; i++) {
        segments[i]!.setAttribute('data-lit', String(i < lit))
      }
    },
  }
}

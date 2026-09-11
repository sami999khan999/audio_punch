/**
 * The DJ-style resonant high-pass / low-pass sweep.
 */
import { PARAMS } from '../shared/params.ts'
import type { ChainState } from '../shared/types.ts'
import { ramp, type ChainModule } from './module.ts'

export class FilterModule implements ChainModule {
  readonly id = 'filter' as const
  readonly input: AudioNode
  readonly output: AudioNode
  private readonly highpass: BiquadFilterNode
  private readonly lowpass: BiquadFilterNode

  constructor(ctx: BaseAudioContext) {
    this.highpass = ctx.createBiquadFilter()
    this.highpass.type = 'highpass'
    this.lowpass = ctx.createBiquadFilter()
    this.lowpass.type = 'lowpass'
    this.highpass.connect(this.lowpass)
    this.input = this.highpass
    this.output = this.lowpass
  }

  isActive(chain: ChainState): boolean {
    if (!chain.filter.on) return false
    // Both sweeps parked at their extremes means the filter is fully open.
    const hpOpen = chain.filter.highpass <= PARAMS.filter.highpass.min
    const lpOpen = chain.filter.lowpass >= PARAMS.filter.lowpass.max
    return !(hpOpen && lpOpen)
  }

  update(chain: ChainState, now: number): void {
    ramp(this.highpass.frequency, chain.filter.highpass, now)
    ramp(this.lowpass.frequency, chain.filter.lowpass, now)
    // Resonance only makes sense on a sweep that is actually doing something;
    // applying Q to a wide-open filter just adds a peak at the edge.
    const hpOpen = chain.filter.highpass <= PARAMS.filter.highpass.min
    const lpOpen = chain.filter.lowpass >= PARAMS.filter.lowpass.max
    ramp(this.highpass.Q, hpOpen ? 0.7 : chain.filter.resonance, now)
    ramp(this.lowpass.Q, lpOpen ? 0.7 : chain.filter.resonance, now)
  }

  dispose(): void {
    this.highpass.disconnect()
    this.lowpass.disconnect()
  }
}

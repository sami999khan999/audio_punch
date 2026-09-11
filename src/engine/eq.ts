/**
 * Graphic EQ and tone shelves.
 */
import { EQ_FREQUENCIES, type ChainState } from '../shared/types.ts'
import { ramp, type ChainModule } from './module.ts'

/** Q giving roughly one-octave bands, so adjacent sliders overlap smoothly. */
const BAND_Q = 1.41

export class EqModule implements ChainModule {
  readonly id = 'eq' as const
  readonly input: AudioNode
  readonly output: AudioNode
  private readonly filters: BiquadFilterNode[]

  constructor(ctx: BaseAudioContext) {
    this.filters = EQ_FREQUENCIES.map((freq) => {
      const filter = ctx.createBiquadFilter()
      filter.type = 'peaking'
      filter.frequency.value = freq
      filter.Q.value = BAND_Q
      filter.gain.value = 0
      return filter
    })
    for (let i = 0; i < this.filters.length - 1; i++) {
      this.filters[i]!.connect(this.filters[i + 1]!)
    }
    this.input = this.filters[0]!
    this.output = this.filters[this.filters.length - 1]!
  }

  isActive(chain: ChainState): boolean {
    return chain.eq.on && chain.eq.bands.some((g) => g !== 0)
  }

  update(chain: ChainState, now: number): void {
    this.filters.forEach((filter, i) => {
      ramp(filter.gain, chain.eq.bands[i] ?? 0, now)
    })
  }

  dispose(): void {
    for (const filter of this.filters) filter.disconnect()
  }
}

/** Corner frequencies for the bass/treble shelves. */
const BASS_SHELF_HZ = 200
const TREBLE_SHELF_HZ = 3500

export class ToneModule implements ChainModule {
  readonly id = 'tone' as const
  readonly input: AudioNode
  readonly output: AudioNode
  private readonly bass: BiquadFilterNode
  private readonly treble: BiquadFilterNode

  constructor(ctx: BaseAudioContext) {
    this.bass = ctx.createBiquadFilter()
    this.bass.type = 'lowshelf'
    this.bass.frequency.value = BASS_SHELF_HZ
    this.treble = ctx.createBiquadFilter()
    this.treble.type = 'highshelf'
    this.treble.frequency.value = TREBLE_SHELF_HZ
    this.bass.connect(this.treble)
    this.input = this.bass
    this.output = this.treble
  }

  isActive(chain: ChainState): boolean {
    return chain.tone.on && (chain.tone.bass !== 0 || chain.tone.treble !== 0)
  }

  update(chain: ChainState, now: number): void {
    ramp(this.bass.gain, chain.tone.bass, now)
    ramp(this.treble.gain, chain.tone.treble, now)
  }

  dispose(): void {
    this.bass.disconnect()
    this.treble.disconnect()
  }
}

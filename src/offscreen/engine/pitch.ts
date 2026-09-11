/**
 * Pitch shift, backed by the phase-vocoder worklet.
 */
import type { ChainState } from '../../shared/types.ts'
import { ramp, type ChainModule } from './module.ts'

export class PitchModule implements ChainModule {
  readonly id = 'pitch' as const
  readonly input: AudioNode
  readonly output: AudioNode
  private readonly node: AudioWorkletNode

  constructor(ctx: BaseAudioContext) {
    this.node = new AudioWorkletNode(ctx as AudioContext, 'pitch-shifter', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    })
    this.input = this.node
    this.output = this.node
  }

  /**
   * A vocoder at unity is still a vocoder: it costs a transform per frame and
   * adds its frame latency. At zero semitones the module leaves the graph.
   */
  isActive(chain: ChainState): boolean {
    return chain.pitch.on && chain.pitch.semitones !== 0
  }

  update(chain: ChainState, now: number): void {
    // Stepping rather than ramping: a swept ratio makes the vocoder's phase
    // accumulator chase a moving target and smears badly.
    const param = this.node.parameters.get('semitones')
    if (param) param.setValueAtTime(chain.pitch.semitones, now)
  }

  dispose(): void {
    this.node.disconnect()
  }
}

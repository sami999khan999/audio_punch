/**
 * Compressor, brick-wall limiter and noise gate.
 */
import type { ChainState } from '../../shared/types.ts'
import { dbToGain, ramp, type ChainModule } from './module.ts'

export class CompModule implements ChainModule {
  readonly id = 'comp' as const
  readonly input: AudioNode
  readonly output: AudioNode
  private readonly comp: DynamicsCompressorNode
  private readonly makeup: GainNode

  constructor(ctx: BaseAudioContext) {
    this.comp = ctx.createDynamicsCompressor()
    this.makeup = ctx.createGain()
    this.comp.connect(this.makeup)
    this.input = this.comp
    this.output = this.makeup
  }

  isActive(chain: ChainState): boolean {
    return chain.comp.on
  }

  update(chain: ChainState, now: number): void {
    ramp(this.comp.threshold, chain.comp.threshold, now)
    ramp(this.comp.knee, chain.comp.knee, now)
    ramp(this.comp.ratio, chain.comp.ratio, now)
    ramp(this.comp.attack, chain.comp.attack, now)
    ramp(this.comp.release, chain.comp.release, now)
    ramp(this.makeup.gain, dbToGain(chain.comp.makeup), now)
  }

  /** Current gain reduction in dB (negative). Drives the compressor meter. */
  reduction(): number {
    return this.comp.reduction
  }

  dispose(): void {
    this.comp.disconnect()
    this.makeup.disconnect()
  }
}

export class LimiterModule implements ChainModule {
  readonly id = 'limiter' as const
  readonly input: AudioNode
  readonly output: AudioNode
  private readonly comp: DynamicsCompressorNode

  constructor(ctx: BaseAudioContext) {
    // A DynamicsCompressorNode at maximum ratio with no knee and the fastest
    // attack the node allows is as close to brick-wall as Web Audio gets
    // without a worklet — good enough to stop boost from clipping, which is
    // the job it is here to do.
    this.comp = ctx.createDynamicsCompressor()
    this.comp.ratio.value = 20
    this.comp.knee.value = 0
    this.comp.attack.value = 0.001
    this.input = this.comp
    this.output = this.comp
  }

  isActive(chain: ChainState): boolean {
    return chain.limiter.on
  }

  update(chain: ChainState, now: number): void {
    ramp(this.comp.threshold, chain.limiter.ceiling, now)
    ramp(this.comp.release, chain.limiter.release, now)
  }

  reduction(): number {
    return this.comp.reduction
  }

  dispose(): void {
    this.comp.disconnect()
  }
}

export class GateModule implements ChainModule {
  readonly id = 'gate' as const
  readonly input: AudioNode
  readonly output: AudioNode
  private readonly node: AudioWorkletNode

  constructor(ctx: BaseAudioContext) {
    this.node = new AudioWorkletNode(ctx as AudioContext, 'noise-gate', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    })
    this.input = this.node
    this.output = this.node
  }

  isActive(chain: ChainState): boolean {
    return chain.gate.on
  }

  update(chain: ChainState, now: number): void {
    const p = this.node.parameters
    ramp(p.get('threshold')!, chain.gate.threshold, now)
    ramp(p.get('attack')!, chain.gate.attack, now)
    ramp(p.get('release')!, chain.gate.release, now)
    ramp(p.get('floor')!, chain.gate.floor, now)
  }

  dispose(): void {
    this.node.disconnect()
  }
}

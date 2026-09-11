/**
 * Reverb, delay and stereo width.
 *
 * The reverb impulse is synthesised rather than shipped as an audio asset:
 * it keeps the extension a few hundred kilobytes smaller, and it lets size,
 * decay and damping be real controls instead of a fixed list of rooms.
 */
import type { ChainState } from '../shared/types.ts'
import { ramp, type ChainModule } from './module.ts'

/** Regenerating an impulse is expensive, so only do it on a real change. */
interface ImpulseKey {
  size: number
  decay: number
  damping: number
}

function buildImpulse(ctx: BaseAudioContext, key: ImpulseKey): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * key.size))
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)

  // Damping is a one-pole lowpass over the noise; a higher value darkens the
  // tail the way absorbent surfaces do.
  const dampCoef = Math.min(0.999, Math.max(0, key.damping)) * 0.9

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let previous = 0
    for (let i = 0; i < length; i++) {
      const noise = Math.random() * 2 - 1
      previous = noise * (1 - dampCoef) + previous * dampCoef
      const envelope = Math.pow(1 - i / length, key.decay)
      data[i] = previous * envelope
    }
  }
  return buffer
}

export class ReverbModule implements ChainModule {
  readonly id = 'reverb' as const
  readonly input: AudioNode
  readonly output: AudioNode
  private readonly ctx: BaseAudioContext
  private readonly split: GainNode
  private readonly merge: GainNode
  private readonly dry: GainNode
  private readonly wet: GainNode
  private readonly convolver: ConvolverNode
  private impulseKey: ImpulseKey | null = null

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
    this.split = ctx.createGain()
    this.merge = ctx.createGain()
    this.dry = ctx.createGain()
    this.wet = ctx.createGain()
    this.convolver = ctx.createConvolver()
    this.convolver.normalize = true

    this.split.connect(this.dry).connect(this.merge)
    this.split.connect(this.convolver).connect(this.wet).connect(this.merge)

    this.input = this.split
    this.output = this.merge
  }

  isActive(chain: ChainState): boolean {
    return chain.reverb.on && chain.reverb.mix > 0
  }

  update(chain: ChainState, now: number): void {
    const key: ImpulseKey = {
      size: chain.reverb.size,
      decay: chain.reverb.decay,
      damping: chain.reverb.damping,
    }
    if (
      !this.impulseKey ||
      this.impulseKey.size !== key.size ||
      this.impulseKey.decay !== key.decay ||
      this.impulseKey.damping !== key.damping
    ) {
      this.convolver.buffer = buildImpulse(this.ctx, key)
      this.impulseKey = key
    }
    // Equal-power crossfade keeps perceived loudness steady across the blend.
    const mix = Math.min(1, Math.max(0, chain.reverb.mix))
    ramp(this.dry.gain, Math.cos((mix * Math.PI) / 2), now)
    ramp(this.wet.gain, Math.sin((mix * Math.PI) / 2), now)
  }

  dispose(): void {
    for (const node of [this.split, this.merge, this.dry, this.wet, this.convolver]) {
      node.disconnect()
    }
  }
}

export class DelayModule implements ChainModule {
  readonly id = 'delay' as const
  readonly input: AudioNode
  readonly output: AudioNode
  private readonly split: GainNode
  private readonly merge: GainNode
  private readonly dry: GainNode
  private readonly wet: GainNode
  private readonly left: DelayNode
  private readonly right: DelayNode
  private readonly feedback: GainNode
  private readonly panLeft: StereoPannerNode
  private readonly panRight: StereoPannerNode
  private pingPong: boolean | null = null

  constructor(ctx: BaseAudioContext) {
    this.split = ctx.createGain()
    this.merge = ctx.createGain()
    this.dry = ctx.createGain()
    this.wet = ctx.createGain()
    // Headroom for the maximum delay time the UI allows.
    this.left = ctx.createDelay(4)
    this.right = ctx.createDelay(4)
    this.feedback = ctx.createGain()
    this.panLeft = ctx.createStereoPanner()
    this.panLeft.pan.value = -0.8
    this.panRight = ctx.createStereoPanner()
    this.panRight.pan.value = 0.8

    this.split.connect(this.dry).connect(this.merge)
    this.split.connect(this.left)
    this.wet.connect(this.merge)

    this.input = this.split
    this.output = this.merge
  }

  isActive(chain: ChainState): boolean {
    return chain.delay.on && chain.delay.mix > 0
  }

  /**
   * Straight delay is one tap feeding back on itself; ping-pong chains a
   * second tap and pans the two apart, so repeats alternate across the image.
   */
  private relink(pingPong: boolean): void {
    this.left.disconnect()
    this.right.disconnect()
    this.feedback.disconnect()
    this.panLeft.disconnect()
    this.panRight.disconnect()

    if (pingPong) {
      this.left.connect(this.panLeft).connect(this.wet)
      this.left.connect(this.right)
      this.right.connect(this.panRight).connect(this.wet)
      this.right.connect(this.feedback).connect(this.left)
    } else {
      this.left.connect(this.wet)
      this.left.connect(this.feedback).connect(this.left)
    }
    this.pingPong = pingPong
  }

  update(chain: ChainState, now: number): void {
    if (this.pingPong !== chain.delay.pingPong) this.relink(chain.delay.pingPong)

    ramp(this.left.delayTime, chain.delay.time, now)
    ramp(this.right.delayTime, chain.delay.time, now)
    ramp(this.feedback.gain, chain.delay.feedback, now)
    const mix = Math.min(1, Math.max(0, chain.delay.mix))
    ramp(this.dry.gain, Math.cos((mix * Math.PI) / 2), now)
    ramp(this.wet.gain, Math.sin((mix * Math.PI) / 2), now)
  }

  dispose(): void {
    for (const node of [
      this.split,
      this.merge,
      this.dry,
      this.wet,
      this.left,
      this.right,
      this.feedback,
      this.panLeft,
      this.panRight,
    ]) {
      node.disconnect()
    }
  }
}

/**
 * Mid/side stereo width.
 *
 *   mid  = (L + R) / 2      side = (L - R) / 2
 *   L'   = mid + side*w     R'   = mid - side*w
 *
 * w = 0 collapses to mono, 1 leaves the signal untouched, 2 doubles the
 * difference information.
 */
export class WidthModule implements ChainModule {
  readonly id = 'width' as const
  readonly input: AudioNode
  readonly output: AudioNode
  private readonly nodes: AudioNode[]
  private readonly sideGain: GainNode

  constructor(ctx: BaseAudioContext) {
    const input = ctx.createGain()
    input.channelCount = 2
    input.channelCountMode = 'explicit'
    input.channelInterpretation = 'speakers'

    const splitter = ctx.createChannelSplitter(2)
    const merger = ctx.createChannelMerger(2)

    const mid = ctx.createGain()
    mid.gain.value = 0.5
    const side = ctx.createGain()
    side.gain.value = 0.5
    const invertR = ctx.createGain()
    invertR.gain.value = -1
    const sideGain = ctx.createGain()
    const invertSide = ctx.createGain()
    invertSide.gain.value = -1
    const outL = ctx.createGain()
    const outR = ctx.createGain()

    input.connect(splitter)
    splitter.connect(mid, 0)
    splitter.connect(mid, 1)
    splitter.connect(side, 0)
    splitter.connect(invertR, 1)
    invertR.connect(side)

    side.connect(sideGain)
    mid.connect(outL)
    sideGain.connect(outL)
    mid.connect(outR)
    sideGain.connect(invertSide).connect(outR)

    outL.connect(merger, 0, 0)
    outR.connect(merger, 0, 1)

    this.sideGain = sideGain
    this.input = input
    this.output = merger
    this.nodes = [input, splitter, merger, mid, side, invertR, sideGain, invertSide, outL, outR]
  }

  isActive(chain: ChainState): boolean {
    return chain.width.on && (chain.width.mono || chain.width.amount !== 1)
  }

  update(chain: ChainState, now: number): void {
    ramp(this.sideGain.gain, chain.width.mono ? 0 : chain.width.amount, now)
  }

  dispose(): void {
    for (const node of this.nodes) node.disconnect()
  }
}

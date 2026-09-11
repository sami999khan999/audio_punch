/**
 * Level metering.
 *
 * One analyser per tab, sampled from a single shared interval rather than a
 * per-tab rAF loop, and only while a UI surface is actually open.
 */
import type { LevelReading } from '../../shared/types.ts'

export const METER_FPS = 30

export class Meter {
  readonly node: AnalyserNode
  private readonly buffer: Float32Array<ArrayBuffer>
  /** Peak decays smoothly so the bar falls back rather than flickering. */
  private heldPeak = 0

  constructor(ctx: BaseAudioContext) {
    this.node = ctx.createAnalyser()
    this.node.fftSize = 1024
    this.node.smoothingTimeConstant = 0
    this.buffer = new Float32Array(this.node.fftSize)
  }

  read(): LevelReading {
    this.node.getFloatTimeDomainData(this.buffer)
    let peak = 0
    let sumSquares = 0
    for (let i = 0; i < this.buffer.length; i++) {
      const sample = this.buffer[i]!
      const magnitude = sample < 0 ? -sample : sample
      if (magnitude > peak) peak = magnitude
      sumSquares += sample * sample
    }
    const decay = 1 - 6 / METER_FPS
    this.heldPeak = peak > this.heldPeak ? peak : this.heldPeak * decay
    return {
      peak: Math.min(1, this.heldPeak),
      rms: Math.min(1, Math.sqrt(sumSquares / this.buffer.length)),
    }
  }

  dispose(): void {
    this.node.disconnect()
  }
}

/**
 * Noise gate: an envelope follower driving a smoothed gain.
 *
 * Split from the worklet so the test suite can drive it offline.
 */

export interface GateSettings {
  /** Gate opens above this level, in dB. */
  threshold: number
  attack: number
  release: number
  /** Gain applied while closed, in dB. */
  floor: number
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

export class NoiseGate {
  private envelope = 0
  private gain = 1
  private readonly sampleRate: number

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }

  /** Converts a time constant in seconds to a one-pole smoothing coefficient. */
  private coefficient(seconds: number): number {
    if (seconds <= 0) return 0
    return Math.exp(-1 / (Math.max(seconds, 1e-5) * this.sampleRate))
  }

  reset(): void {
    this.envelope = 0
    this.gain = 1
  }

  /**
   * Processes one block in place. `key` is the signal the envelope follows,
   * which for a simple gate is the input itself.
   */
  process(input: Float32Array, output: Float32Array, settings: GateSettings): void {
    const openThreshold = dbToGain(settings.threshold)
    // Hysteresis: the gate holds open 6 dB below the opening point, so a
    // signal hovering at the threshold does not chatter.
    const closeThreshold = openThreshold * dbToGain(-6)
    const floorGain = dbToGain(settings.floor)
    const attackCoef = this.coefficient(settings.attack)
    const releaseCoef = this.coefficient(settings.release)
    // The envelope tracks peaks quickly and decays slowly.
    const envDecay = this.coefficient(0.05)

    let open = this.gain > (1 + floorGain) / 2
    for (let i = 0; i < input.length; i++) {
      const level = Math.abs(input[i]!)
      this.envelope = level > this.envelope ? level : this.envelope * envDecay + level * (1 - envDecay)

      if (open) {
        if (this.envelope < closeThreshold) open = false
      } else if (this.envelope > openThreshold) {
        open = true
      }

      const target = open ? 1 : floorGain
      const coef = target > this.gain ? attackCoef : releaseCoef
      this.gain = target + (this.gain - target) * coef
      output[i] = input[i]! * this.gain
    }
  }
}

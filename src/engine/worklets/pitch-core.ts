/**
 * Streaming phase vocoder — pitch shift with the tempo left alone.
 *
 * Analysis/synthesis run at the same hop; the shift happens in the frequency
 * domain by mapping each bin's magnitude and *true* frequency (estimated from
 * the phase advance between frames) onto a scaled bin. That avoids the
 * resampling stage a time-stretch-then-resample shifter would need, which
 * matters here because the worklet has to run in fixed 128-sample quanta.
 *
 * Deliberately free of AudioWorklet globals so it can be driven offline by the
 * test suite.
 */
import { FFT, hannWindow } from './fft.ts'

export const FRAME_SIZE = 2048
export const OVERSAMPLING = 4

export class PhaseVocoder {
  readonly frameSize: number
  readonly oversampling: number
  readonly stepSize: number
  /** Samples of delay the vocoder introduces; reported so callers can align. */
  readonly latency: number

  private readonly fft: FFT
  private readonly window: Float64Array
  private readonly freqPerBin: number
  private readonly expectedPhaseAdvance: number

  private readonly inFifo: Float64Array
  private readonly outFifo: Float64Array
  private readonly outputAccum: Float64Array
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly lastPhase: Float64Array
  private readonly sumPhase: Float64Array
  private readonly anaMagn: Float64Array
  private readonly anaFreq: Float64Array
  private readonly synMagn: Float64Array
  private readonly synFreq: Float64Array

  private rover: number
  private ratio = 1

  constructor(sampleRate: number, frameSize = FRAME_SIZE, oversampling = OVERSAMPLING) {
    this.frameSize = frameSize
    this.oversampling = oversampling
    this.stepSize = Math.floor(frameSize / oversampling)
    this.latency = frameSize - this.stepSize

    this.fft = new FFT(frameSize)
    this.window = hannWindow(frameSize)
    this.freqPerBin = sampleRate / frameSize
    this.expectedPhaseAdvance = (2 * Math.PI * this.stepSize) / frameSize

    const half = frameSize / 2 + 1
    this.inFifo = new Float64Array(frameSize)
    this.outFifo = new Float64Array(frameSize)
    this.outputAccum = new Float64Array(frameSize * 2)
    this.re = new Float64Array(frameSize)
    this.im = new Float64Array(frameSize)
    this.lastPhase = new Float64Array(half)
    this.sumPhase = new Float64Array(half)
    this.anaMagn = new Float64Array(half)
    this.anaFreq = new Float64Array(half)
    this.synMagn = new Float64Array(half)
    this.synFreq = new Float64Array(half)

    this.rover = this.latency
  }

  /** Frequency multiplier: 2 doubles the pitch, 0.5 halves it. */
  setRatio(ratio: number): void {
    this.ratio = Math.min(4, Math.max(0.25, ratio))
  }

  static ratioFromSemitones(semitones: number): number {
    return Math.pow(2, semitones / 12)
  }

  /** Drops all history. Call when the signal source changes. */
  reset(): void {
    this.inFifo.fill(0)
    this.outFifo.fill(0)
    this.outputAccum.fill(0)
    this.lastPhase.fill(0)
    this.sumPhase.fill(0)
    this.rover = this.latency
  }

  /** Processes one block. `input` and `output` may be the same array. */
  process(input: Float32Array, output: Float32Array): void {
    const { frameSize, stepSize, latency } = this
    for (let i = 0; i < input.length; i++) {
      this.inFifo[this.rover] = input[i]!
      output[i] = this.outFifo[this.rover - latency]!
      this.rover++

      if (this.rover >= frameSize) {
        this.rover = latency
        this.processFrame()

        for (let k = 0; k < stepSize; k++) this.outFifo[k] = this.outputAccum[k]!
        this.outputAccum.copyWithin(0, stepSize, stepSize + frameSize)
        this.outputAccum.fill(0, frameSize, frameSize + stepSize)
        for (let k = 0; k < latency; k++) this.inFifo[k] = this.inFifo[k + stepSize]!
      }
    }
  }

  private processFrame(): void {
    const {
      frameSize,
      oversampling,
      window,
      re,
      im,
      lastPhase,
      sumPhase,
      anaMagn,
      anaFreq,
      synMagn,
      synFreq,
      freqPerBin,
      expectedPhaseAdvance,
      ratio,
    } = this
    const half = frameSize / 2

    for (let k = 0; k < frameSize; k++) {
      re[k] = this.inFifo[k]! * window[k]!
      im[k] = 0
    }
    this.fft.forward(re, im)

    for (let k = 0; k <= half; k++) {
      const real = re[k]!
      const imag = im[k]!
      const magnitude = 2 * Math.sqrt(real * real + imag * imag)
      const phase = Math.atan2(imag, real)

      // Deviation from the phase advance this bin would show if it held
      // exactly its centre frequency.
      let delta = phase - lastPhase[k]!
      lastPhase[k] = phase
      delta -= k * expectedPhaseAdvance

      // Wrap into [-pi, pi].
      let wraps = Math.trunc(delta / Math.PI)
      wraps += wraps >= 0 ? wraps & 1 : -(wraps & 1)
      delta -= Math.PI * wraps

      const deviation = (oversampling * delta) / (2 * Math.PI)
      anaMagn[k] = magnitude
      anaFreq[k] = (k + deviation) * freqPerBin
    }

    synMagn.fill(0)
    synFreq.fill(0)
    for (let k = 0; k <= half; k++) {
      const target = Math.round(k * ratio)
      if (target > half) break
      synMagn[target] = synMagn[target]! + anaMagn[k]!
      synFreq[target] = anaFreq[k]! * ratio
    }

    for (let k = 0; k <= half; k++) {
      const magnitude = synMagn[k]!
      const deviation = synFreq[k]! / freqPerBin - k
      const advance = ((2 * Math.PI * deviation) / oversampling) + k * expectedPhaseAdvance
      sumPhase[k] = sumPhase[k]! + advance
      const phase = sumPhase[k]!
      re[k] = magnitude * Math.cos(phase)
      im[k] = magnitude * Math.sin(phase)
    }
    // Only the lower half carries signal; the magnitude doubling above stands
    // in for the discarded mirror bins.
    for (let k = half + 1; k < frameSize; k++) {
      re[k] = 0
      im[k] = 0
    }

    this.fft.inverse(re, im)

    // 4/oversampling undoes the half-spectrum magnitude doubling against the
    // 1/N-normalised inverse; overlapGain undoes the analysis+synthesis Hann
    // pair, which sums to (3/8) * oversampling across hops. Verified at unity
    // ratio by test/pitch.test.ts.
    const overlapGain = (3 / 8) * oversampling
    const scale = 4 / oversampling / overlapGain
    for (let k = 0; k < frameSize; k++) {
      this.outputAccum[k] = this.outputAccum[k]! + window[k]! * re[k]! * scale
    }
  }
}

/**
 * AudioWorklet wrapper around the phase vocoder.
 *
 * One vocoder instance per channel — shifting mid/side instead would cost less
 * CPU but smears the stereo image, and this runs at most a handful of times.
 *
 * The node stays in the graph only while the pitch module is engaged at a
 * non-zero offset; `src/offscreen/engine/graph.ts` unlinks it otherwise, so
 * neither its latency nor its cost exists at rest.
 */
import { PhaseVocoder } from './pitch-core.ts'

const SEMITONE_EPSILON = 0.001

class PitchShifterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      {
        name: 'semitones',
        defaultValue: 0,
        minValue: -24,
        maxValue: 24,
        automationRate: 'k-rate',
      },
    ]
  }

  private voices: PhaseVocoder[] = []
  private lastSemitones = 0

  override process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || !output || input.length === 0) return true

    const semitones = parameters.semitones?.[0] ?? 0

    // At unity, copy through rather than paying for the transform.
    if (Math.abs(semitones) < SEMITONE_EPSILON) {
      for (let c = 0; c < output.length; c++) {
        const src = input[Math.min(c, input.length - 1)]
        const dst = output[c]
        if (dst) dst.set(src ?? new Float32Array(dst.length))
      }
      this.lastSemitones = 0
      return true
    }

    if (semitones !== this.lastSemitones) {
      const ratio = PhaseVocoder.ratioFromSemitones(semitones)
      for (const voice of this.voices) voice.setRatio(ratio)
      this.lastSemitones = semitones
    }

    for (let c = 0; c < output.length; c++) {
      const src = input[Math.min(c, input.length - 1)]
      const dst = output[c]
      if (!dst) continue
      if (!src) {
        dst.fill(0)
        continue
      }
      let voice = this.voices[c]
      if (!voice) {
        voice = new PhaseVocoder(sampleRate)
        voice.setRatio(PhaseVocoder.ratioFromSemitones(semitones))
        this.voices[c] = voice
      }
      voice.process(src, dst)
    }
    return true
  }
}

registerProcessor('pitch-shifter', PitchShifterProcessor)

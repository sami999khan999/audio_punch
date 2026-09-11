/**
 * AudioWorklet wrapper around the noise gate.
 *
 * Web Audio has no gate node, and a DynamicsCompressorNode cannot express a
 * downward expander, so this is the one dynamics module that needs a worklet.
 */
import { NoiseGate, type GateSettings } from './gate-core.ts'

class GateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: 'threshold', defaultValue: -50, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 0.005, minValue: 0.0001, maxValue: 1, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.15, minValue: 0.001, maxValue: 4, automationRate: 'k-rate' },
      { name: 'floor', defaultValue: -80, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
    ]
  }

  private gates: NoiseGate[] = []

  override process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || !output || input.length === 0) return true

    const settings: GateSettings = {
      threshold: parameters.threshold?.[0] ?? -50,
      attack: parameters.attack?.[0] ?? 0.005,
      release: parameters.release?.[0] ?? 0.15,
      floor: parameters.floor?.[0] ?? -80,
    }

    for (let c = 0; c < output.length; c++) {
      const src = input[Math.min(c, input.length - 1)]
      const dst = output[c]
      if (!dst) continue
      if (!src) {
        dst.fill(0)
        continue
      }
      let gate = this.gates[c]
      if (!gate) {
        gate = new NoiseGate(sampleRate)
        this.gates[c] = gate
      }
      gate.process(src, dst, settings)
    }
    return true
  }
}

registerProcessor('noise-gate', GateProcessor)

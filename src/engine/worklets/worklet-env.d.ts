/**
 * AudioWorkletGlobalScope declarations. These globals exist only inside a
 * worklet, so TypeScript's DOM lib does not describe them.
 */
declare const sampleRate: number
declare const currentTime: number

interface AudioParamDescriptor {
  name: string
  defaultValue?: number
  minValue?: number
  maxValue?: number
  automationRate?: 'a-rate' | 'k-rate'
}

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean
}

declare function registerProcessor(
  name: string,
  ctor: new (options?: unknown) => AudioWorkletProcessor,
): void

/**
 * The signal-processing core.
 *
 * The phase vocoder is the one piece here that cannot be checked by reading
 * it — a normalisation error is inaudible as "slightly wrong" and obvious as
 * "everything is 3.5 dB loud". These tests pin the pitch it produces and the
 * gain it does not.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { FFT, hannWindow } from '../src/engine/worklets/fft.ts'
import { PhaseVocoder } from '../src/engine/worklets/pitch-core.ts'
import { NoiseGate, dbToGain } from '../src/engine/worklets/gate-core.ts'

const SR = 48000

function sine(freq: number, length: number, amplitude = 1): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / SR)
  return out
}

function rms(buf: Float32Array, from = 0, to = buf.length): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += buf[i]! * buf[i]!
  return Math.sqrt(sum / (to - from))
}

/** Dominant frequency via the largest FFT magnitude bin. */
function dominantHz(buf: Float32Array, from: number, size = 8192): number {
  const fft = new FFT(size)
  const window = hannWindow(size)
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let i = 0; i < size; i++) re[i] = (buf[from + i] ?? 0) * window[i]!
  fft.forward(re, im)

  let best = 0
  let bestMag = -1
  for (let k = 1; k < size / 2; k++) {
    const mag = re[k]! * re[k]! + im[k]! * im[k]!
    if (mag > bestMag) {
      bestMag = mag
      best = k
    }
  }
  return (best * SR) / size
}

// ─────────────────────────────────────────────────────────── FFT

test('the inverse FFT reconstructs the input', () => {
  const size = 256
  const fft = new FFT(size)
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  const original: number[] = []
  for (let i = 0; i < size; i++) {
    const value = Math.sin(i / 3) + 0.4 * Math.cos(i / 7) + (i % 11) / 11
    re[i] = value
    original.push(value)
  }

  fft.forward(re, im)
  fft.inverse(re, im)

  for (let i = 0; i < size; i++) {
    assert.ok(Math.abs(re[i]! - original[i]!) < 1e-9, `sample ${i} drifted`)
    assert.ok(Math.abs(im[i]!) < 1e-9, `sample ${i} gained an imaginary part`)
  }
})

test('the FFT puts a pure tone in the expected bin', () => {
  const size = 1024
  const binHz = SR / size
  const targetBin = 64
  const fft = new FFT(size)
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let i = 0; i < size; i++) re[i] = Math.sin((2 * Math.PI * targetBin * i) / size)
  fft.forward(re, im)

  let best = 0
  let bestMag = -1
  for (let k = 1; k < size / 2; k++) {
    const mag = re[k]! * re[k]! + im[k]! * im[k]!
    if (mag > bestMag) {
      bestMag = mag
      best = k
    }
  }
  assert.equal(best, targetBin, `expected ${targetBin * binHz}Hz`)
})

test('a non-power-of-two size is refused', () => {
  assert.throws(() => new FFT(1000), /power of two/)
})

// ───────────────────────────────────────────── phase vocoder

function runVocoder(input: Float32Array, semitones: number): Float32Array {
  const vocoder = new PhaseVocoder(SR)
  vocoder.setRatio(PhaseVocoder.ratioFromSemitones(semitones))
  const output = new Float32Array(input.length)
  // 128 frames is the AudioWorklet render quantum, so this is the real path.
  for (let i = 0; i < input.length; i += 128) {
    vocoder.process(input.subarray(i, i + 128), output.subarray(i, i + 128))
  }
  return output
}

test('the vocoder passes audio through at unity gain when not shifting', () => {
  const input = sine(440, SR)
  const output = runVocoder(input, 0)
  const ratio = rms(output, SR / 2) / rms(input, SR / 2)
  assert.ok(
    Math.abs(ratio - 1) < 0.02,
    `unity ratio should not change level, got ${ratio.toFixed(4)}×`,
  )
})

test('shifting up an octave doubles the frequency', () => {
  const output = runVocoder(sine(440, SR), 12)
  const hz = dominantHz(output, SR / 2)
  assert.ok(Math.abs(hz - 880) < 12, `expected ~880Hz, got ${hz.toFixed(1)}Hz`)
})

test('shifting down an octave halves the frequency', () => {
  const output = runVocoder(sine(440, SR), -12)
  const hz = dominantHz(output, SR / 2)
  assert.ok(Math.abs(hz - 220) < 12, `expected ~220Hz, got ${hz.toFixed(1)}Hz`)
})

test('a seven-semitone shift lands on the right interval', () => {
  const expected = 440 * Math.pow(2, 7 / 12)
  const hz = dominantHz(runVocoder(sine(440, SR), 7), SR / 2)
  assert.ok(Math.abs(hz - expected) < 15, `expected ~${expected.toFixed(1)}Hz, got ${hz.toFixed(1)}Hz`)
})

test('the shift does not change the duration', () => {
  const input = sine(440, SR)
  const output = runVocoder(input, 5)
  assert.equal(output.length, input.length)
  // Energy must still be present at the end: a time-stretching bug would
  // leave the tail empty.
  assert.ok(rms(output, input.length - 4800) > 0.05)
})

test('the ratio is clamped to a range the vocoder can actually do', () => {
  const vocoder = new PhaseVocoder(SR)
  vocoder.setRatio(100)
  const output = new Float32Array(1024)
  assert.doesNotThrow(() => vocoder.process(sine(440, 1024), output))
})

// ───────────────────────────────────────────────────── gate

test('the gate passes signal above the threshold', () => {
  const gate = new NoiseGate(SR)
  const input = sine(440, SR / 2, 0.5)
  const output = new Float32Array(input.length)
  gate.process(input, output, { threshold: -40, attack: 0.001, release: 0.01, floor: -80 })
  const ratio = rms(output, input.length / 2) / rms(input, input.length / 2)
  assert.ok(ratio > 0.95, `loud signal should pass, got ${ratio.toFixed(3)}`)
})

test('the gate closes on signal below the threshold', () => {
  const gate = new NoiseGate(SR)
  const quiet = sine(440, SR / 2, dbToGain(-60))
  const output = new Float32Array(quiet.length)
  gate.process(quiet, output, { threshold: -30, attack: 0.001, release: 0.01, floor: -80 })
  const ratio = rms(output, quiet.length / 2) / rms(quiet, quiet.length / 2)
  assert.ok(ratio < 0.05, `quiet signal should be gated, got ${ratio.toFixed(3)}`)
})

test('the gate floor sets how far down a closed gate goes', () => {
  const gate = new NoiseGate(SR)
  const quiet = sine(440, SR / 2, dbToGain(-60))
  const output = new Float32Array(quiet.length)
  gate.process(quiet, output, { threshold: -30, attack: 0.001, release: 0.01, floor: -12 })
  const ratio = rms(output, quiet.length / 2) / rms(quiet, quiet.length / 2)
  // -12 dB is about 0.25; allow for the envelope still settling.
  assert.ok(ratio > 0.2 && ratio < 0.35, `expected roughly -12dB, got ${ratio.toFixed(3)}`)
})

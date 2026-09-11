/**
 * Iterative radix-2 FFT with precomputed twiddle tables.
 *
 * Lives in its own module so the phase vocoder and the test suite share one
 * implementation. No dependencies — it is bundled into the AudioWorklet.
 */

function reverseBits(value: number, width: number): number {
  let result = 0
  for (let i = 0; i < width; i++) {
    result = (result << 1) | ((value >>> i) & 1)
  }
  return result >>> 0
}

export class FFT {
  readonly size: number
  private readonly levels: number
  private readonly cosTable: Float64Array
  private readonly sinTable: Float64Array
  private readonly reversed: Uint32Array

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`)
    }
    this.size = size
    this.levels = Math.log2(size)
    const half = size >>> 1
    this.cosTable = new Float64Array(half)
    this.sinTable = new Float64Array(half)
    for (let i = 0; i < half; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / size)
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / size)
    }
    this.reversed = new Uint32Array(size)
    for (let i = 0; i < size; i++) this.reversed[i] = reverseBits(i, this.levels)
  }

  /**
   * In-place transform. `forward` uses the e^(-i2*pi*kn/N) convention; the
   * inverse is normalised by 1/N so that inverse(forward(x)) === x.
   */
  private transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const n = this.size
    if (re.length < n || im.length < n) throw new Error('FFT buffers are too short')

    for (let i = 0; i < n; i++) {
      const j = this.reversed[i]!
      if (j > i) {
        const tr = re[i]!
        re[i] = re[j]!
        re[j] = tr
        const ti = im[i]!
        im[i] = im[j]!
        im[j] = ti
      }
    }

    for (let span = 2; span <= n; span <<= 1) {
      const half = span >>> 1
      const stride = n / span
      for (let start = 0; start < n; start += span) {
        for (let j = start, k = 0; j < start + half; j++, k += stride) {
          const partner = j + half
          const c = this.cosTable[k]!
          const s = inverse ? this.sinTable[k]! : -this.sinTable[k]!
          const pr = re[partner]!
          const pi = im[partner]!
          const tr = pr * c - pi * s
          const ti = pr * s + pi * c
          re[partner] = re[j]! - tr
          im[partner] = im[j]! - ti
          re[j] = re[j]! + tr
          im[j] = im[j]! + ti
        }
      }
    }

    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] = re[i]! / n
        im[i] = im[i]! / n
      }
    }
  }

  forward(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, false)
  }

  inverse(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, true)
  }
}

/** Periodic Hann window, the correct variant for overlap-add resynthesis. */
export function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size)
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size))
  }
  return w
}

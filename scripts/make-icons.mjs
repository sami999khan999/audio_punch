/**
 * Generates the extension icons as PNGs with no image dependencies.
 * Run with `node scripts/make-icons.mjs`. Output: public/icons/icon-<size>.png
 *
 * The mark is three fader bars of differing height on a rounded dark tile —
 * legible down to 16px, which rules out anything more detailed.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const BG = [0x0e, 0x0f, 0x13]
const ACCENT = [0xff, 0xa7, 0x2b]
const ACCENT_DIM = [0x3d, 0x2c, 0x12]

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // 10..12 = compression, filter, interlace, all zero

  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter type: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Coverage of a pixel by a rounded rectangle, sampled 3x3 for cheap AA. */
function roundedRectCoverage(x, y, w, h, r) {
  let hits = 0
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const px = x + (sx + 0.5) / 3
      const py = y + (sy + 0.5) / 3
      if (px < 0 || py < 0 || px > w || py > h) continue
      const cx = Math.min(Math.max(px, r), w - r)
      const cy = Math.min(Math.max(py, r), h - r)
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) hits++
    }
  }
  return hits / 9
}

function blend(dst, offset, colour, alpha) {
  for (let i = 0; i < 3; i++) {
    dst[offset + i] = Math.round(dst[offset + i] * (1 - alpha) + colour[i] * alpha)
  }
  dst[offset + 3] = Math.round(dst[offset + 3] * (1 - alpha) + 255 * alpha)
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4) // transparent
  const tileRadius = size * 0.22

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = roundedRectCoverage(x, y, size, size, tileRadius)
      if (a > 0) blend(px, (y * size + x) * 4, BG, a)
    }
  }

  // Three faders: [x-centre fraction, filled-from-bottom fraction]
  const faders = [
    [0.28, 0.62],
    [0.5, 0.88],
    [0.72, 0.4],
  ]
  const barW = Math.max(1.6, size * 0.11)
  const top = size * 0.2
  const bottom = size * 0.8
  const trackH = bottom - top

  for (const [cx, fill] of faders) {
    const x0 = size * cx - barW / 2
    const capR = barW / 2
    const fillTop = bottom - trackH * fill

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const lx = x - x0
        const ly = y - top
        const track = roundedRectCoverage(lx, ly, barW, trackH, capR)
        if (track > 0) blend(px, (y * size + x) * 4, ACCENT_DIM, track)

        const ly2 = y - fillTop
        const lit = roundedRectCoverage(lx, ly2, barW, bottom - fillTop, capR)
        if (lit > 0) blend(px, (y * size + x) * 4, ACCENT, lit)
      }
    }
  }

  return encodePng(size, px)
}

mkdirSync('public/icons', { recursive: true })
for (const size of [16, 32, 48, 128]) {
  writeFileSync(`public/icons/icon-${size}.png`, draw(size))
  console.log(`public/icons/icon-${size}.png`)
}

/**
 * Regression checks for the two defects that made the extension unusable with
 * video: a closed overlay swallowing page clicks, and the overlay vanishing in
 * fullscreen. Both are DOM-level and only observable in a real browser.
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/chrome', import.meta.url))
const checks = []
const check = (name, pass, detail = '') => {
  checks.push({ name, pass })
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

const server = createServer((_q, r) => {
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  r.end(`<!doctype html><title>Audio Punch regression</title>
  <style>body{margin:0;font:14px system-ui;background:#151515;color:#eee}
  #v{width:640px;height:360px;background:#2a2a2a;margin:0}
  #go{margin:12px;padding:10px 16px;font-size:15px}</style>
  <div id="v"></div><button id="go">fullscreen</button>
  <script>
    window.__clicks = 0
    document.getElementById('go').addEventListener('click', () => {
      window.__clicks++
      document.getElementById('v').requestFullscreen()
    })
  </script>`)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

let ctx, profile
try {
  profile = await mkdtemp(join(tmpdir(), 'ap-reg-'))
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    viewport: { width: 1280, height: 800 },
    args: ['--headless=new', `--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--no-sandbox'],
  })
  let [w] = ctx.serviceWorkers()
  if (!w) w = await ctx.waitForEvent('serviceworker', { timeout: 15000 })
  const id = new URL(w.url()).host

  const page = await ctx.newPage()
  await page.goto(base)
  await page.waitForTimeout(800)

  // ── 1. closed overlay must be invisible to hit-testing ────────────────
  const closedHits = await page.evaluate(() =>
    [10, 150, 300, 450, 600].map((y) => {
      const el = document.elementFromPoint(640, y)
      return el ? el.id || el.tagName : 'null'
    }),
  )
  check(
    'a closed overlay does not intercept page clicks',
    !closedHits.some((h) => h.includes('audio-punch')),
    closedHits.join(', '),
  )

  // Clicking the page must reach the page, not the extension.
  await page.click('#go')
  await page.waitForTimeout(500)
  check('the page receives its own clicks', (await page.evaluate(() => window.__clicks)) === 1)
  check('fullscreen works with the extension loaded', await page.evaluate(() => !!document.fullscreenElement))

  // ── 2. the overlay survives fullscreen ────────────────────────────────
  const dash = await ctx.newPage()
  await dash.goto(`chrome-extension://${id}/dashboard.html`)
  await dash.waitForSelector('.ap-page')
  const tabs = await dash.evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url })))
  const target = tabs.find((t) => (t.url || '').includes('127.0.0.1'))
  await dash.evaluate(async (tid) => chrome.tabs.sendMessage(tid, { type: 'content:open-overlay' }), target.id)

  await page.bringToFront()
  await page.waitForTimeout(900)

  const inFullscreen = await page.evaluate(() => {
    const host = document.getElementById('audio-punch-overlay-host')
    const fs = document.fullscreenElement
    return {
      hostExists: !!host,
      fullscreen: !!fs,
      insideFullscreenElement: !!(fs && host && fs.contains(host)),
      visible: host ? getComputedStyle(host).display !== 'none' : false,
    }
  })
  check(
    'the overlay re-parents into the fullscreen element',
    inFullscreen.insideFullscreenElement,
    JSON.stringify(inFullscreen),
  )
  check('the overlay is visible while open', inFullscreen.visible)

  // ── 3. closing releases the page again ────────────────────────────────
  await dash.evaluate(async (tid) => chrome.tabs.sendMessage(tid, { type: 'content:close-overlay' }), target.id)
  await page.bringToFront()
  await page.waitForTimeout(600)
  const afterClose = await page.evaluate(() => {
    const el = document.elementFromPoint(640, 300)
    return el ? el.id || el.tagName : 'null'
  })
  check('closing hands the page back', !afterClose.includes('audio-punch'), afterClose)
} finally {
  await ctx?.close()
  await new Promise((r) => server.close(r))
  if (profile) await rm(profile, { recursive: true, force: true })
}

const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

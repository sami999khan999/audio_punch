/**
 * Loads the built extension into a real Chromium and checks the things that
 * only exist at runtime: the worker starts, the content script routes the
 * page's audio, the popup renders and drives it, and per-site versus global
 * behave the way the unit tests say they should.
 *
 * Needs Playwright (`npm i -D playwright`) and a built `dist/chrome`.
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

const WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

// A second origin, serving media with no CORS headers. This is what a
// self-hosted player or a plain CDN <video src> looks like, and it is the case
// that cannot be routed through Web Audio without silencing the page.
const cdn = createServer((_q, r) => {
  r.writeHead(200, { 'content-type': 'audio/wav' })
  r.end(Buffer.from(WAV.split(',')[1], 'base64'))
})
await new Promise((r) => cdn.listen(0, '127.0.0.1', r))
const CDN = `http://127.0.0.1:${cdn.address().port}/tone.wav`

const server = createServer((q, r) => {
  if (q.url === '/frame') {
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    r.end(`<!doctype html><title>embed</title><video id="inner" src="${CDN}"></video>`)
    return
  }
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  // The four shapes real sites use: a top-level same-origin player, a
  // cross-origin one, one inside a shadow root, and one inside an iframe.
  r.end(`<!doctype html><title>Audio Punch smoke</title>
  <video id="v" controls src="${WAV}" style="width:480px;height:270px;background:#222"></video>
  <video id="cross" src="${CDN}"></video>
  <div id="host"></div>
  <iframe id="embed" src="/frame" width="320" height="180"></iframe>
  <button id="fs">fullscreen</button>
  <script>
    const root = document.getElementById('host').attachShadow({ mode: 'open' })
    const sv = document.createElement('video')
    sv.id = 'shadow'; sv.src = ${JSON.stringify(CDN)}
    root.appendChild(sv)
    document.getElementById('fs').onclick = () => document.getElementById('v').requestFullscreen()
  </script>`)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

let ctx, profile
try {
  profile = await mkdtemp(join(tmpdir(), 'audio-punch-'))
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [
      '--headless=new',
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })

  let worker = ctx.serviceWorkers()[0]
  if (!worker) worker = await ctx.waitForEvent('serviceworker', { timeout: 15000 })
  check('the service worker starts', Boolean(worker))
  const id = new URL(worker.url()).host

  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.goto(base)
  await page.waitForTimeout(700)
  // Checked early and by name: a throw during setup takes the message listener
  // with it, and everything after then fails as "receiving end does not exist".
  check('the content script loads without throwing', pageErrors.length === 0, pageErrors.join('; '))

  const popup = await ctx.newPage()
  const popupErrors = []
  popup.on('pageerror', (e) => popupErrors.push(e.message))
  await popup.goto(`chrome-extension://${id}/popup.html`)
  await popup.waitForSelector('.value')
  check('the popup renders', (await popup.locator('.value').textContent()) === '100%')
  check('the popup throws nothing', popupErrors.length === 0, popupErrors.join('; '))

  // A real popup floats over the active tab rather than occupying one, so the
  // page is brought back to the front before anything that resolves "this
  // site" — otherwise the popup's own tab would be the active one.
  await page.bringToFront()
  const ask = (message) => popup.evaluate((m) => chrome.runtime.sendMessage(m), message)
  const pageState = () =>
    popup.evaluate(async () => {
      const tabs = await chrome.tabs.query({})
      const target = tabs.find((t) => (t.title ?? '').includes('Audio Punch smoke'))
      try {
        // Targeted at the main frame: the script now runs in every frame, and
        // an unaddressed sendMessage is answered by whichever replies first.
        return await chrome.tabs.sendMessage(target.id, { type: 'content:state' }, { frameId: 0 })
      } catch (err) {
        return { error: String(err) }
      }
    })

  const initial = await pageState()
  check('the content script responds', initial?.ok === true, initial?.error ?? '')
  check(
    'it found every player in the main frame',
    initial?.media === 3,
    `${initial?.media} found (same-origin, cross-origin, shadow)`,
  )
  check('it built the gain node', initial?.routed === true)

  // ── per site ──────────────────────────────────────────────────────────
  await ask({ type: 'popup:set-volume', scope: 'site', volume: 2.5 })
  await popup.waitForTimeout(200)
  let applied = await pageState()
  check('a per-site volume reaches the page', applied?.audio?.volume === 2.5, `${applied?.audio?.volume}`)

  // Storage writes are debounced by design (holding the volume shortcut would
  // otherwise write on every keypress), so give that timer room.
  await popup.waitForTimeout(450)
  const stored = await popup.evaluate(async () => {
    const bag = await chrome.storage.local.get('audio-punch:settings')
    return bag['audio-punch:settings']
  })
  check('it is stored against the origin', Object.keys(stored?.sites ?? {}).length === 1, Object.keys(stored?.sites ?? {}).join(','))

  await ask({ type: 'popup:set-muted', scope: 'site', muted: true })
  await popup.waitForTimeout(200)
  applied = await pageState()
  check('mute reaches the page', applied?.audio?.muted === true)

  await ask({ type: 'popup:nudge-volume', scope: 'site', steps: 1 })
  await popup.waitForTimeout(200)
  applied = await pageState()
  check('turning up while muted unmutes', applied?.audio?.muted === false)

  // ── global ────────────────────────────────────────────────────────────
  await ask({ type: 'popup:set-global-on', on: true })
  await ask({ type: 'popup:set-volume', scope: 'global', volume: 0.4 })
  await popup.waitForTimeout(250)
  applied = await pageState()
  check('global overrides the site', applied?.audio?.volume === 0.4, `${applied?.audio?.volume}`)

  await ask({ type: 'popup:set-global-on', on: false })
  await popup.waitForTimeout(250)
  applied = await pageState()
  check(
    'turning global off restores the site value',
    applied?.audio?.volume === 2.6,
    `${applied?.audio?.volume}`,
  )

  // ── the shapes other sites use ────────────────────────────────────────
  // YouTube is a top-level <video> with a blob: source, which is the easy case.
  // These are the three that were failing.
  await ask({ type: 'popup:set-volume', scope: 'site', volume: 0.4 })
  await page.waitForTimeout(500)

  const shapes = await page.evaluate(() => ({
    same: document.getElementById('v').volume,
    cross: document.getElementById('cross').volume,
    shadow: document.getElementById('host').shadowRoot.getElementById('shadow').volume,
  }))
  const frame = page.frames().find((f) => f.url().includes('/frame'))
  shapes.inner = frame ? await frame.evaluate(() => document.getElementById('inner').volume) : null

  check(
    'a same-origin player is routed, not touched directly',
    shapes.same === 1,
    `volume ${shapes.same}`,
  )
  check(
    'cross-origin media is driven directly rather than silenced',
    shapes.cross === 0.4,
    `volume ${shapes.cross}`,
  )
  check('media inside a shadow root is found', shapes.shadow === 0.4, `volume ${shapes.shadow}`)
  check('media inside an iframe is found', shapes.inner === 0.4, `volume ${shapes.inner}`)

  const capped = await popup.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ type: 'popup:hello' })
    return r.ok ? r.state.boostCapped : null
  })
  check('the popup is told boost is capped here', capped === true, String(capped))

  // A site muting its own player must not be undone by our "not muted" state.
  await page.evaluate(() => { document.getElementById('cross').muted = true })
  await ask({ type: 'popup:set-volume', scope: 'site', volume: 0.6 })
  await page.waitForTimeout(400)
  check(
    "a site's own mute is left alone",
    await page.evaluate(() => document.getElementById('cross').muted),
  )

  // ── fullscreen ────────────────────────────────────────────────────────
  // The browser restricts keyboard input in fullscreen, so chrome.commands
  // stops firing and the toolbar (and so the popup) is hidden. The content
  // script listens itself there. This is the only end-to-end cover the
  // shortcut path has, since chrome.commands cannot be fired from here.
  await ask({ type: 'popup:set-volume', scope: 'site', volume: 1 })
  await page.bringToFront()
  await page.click('#fs')
  await page.waitForTimeout(500)
  check('the page goes fullscreen', await page.evaluate(() => !!document.fullscreenElement))

  const bindingCount = (await pageState())?.bindings
  check('the page received the live shortcut bindings', bindingCount === 4, `${bindingCount}`)

  await page.keyboard.press('Alt+Shift+ArrowUp')
  await page.waitForTimeout(350)
  applied = await pageState()
  check('volume up works in fullscreen', applied?.audio?.volume === 1.1, `${applied?.audio?.volume}`)

  await page.keyboard.press('Alt+Shift+ArrowDown')
  await page.keyboard.press('Alt+Shift+ArrowDown')
  await page.waitForTimeout(400)
  applied = await pageState()
  check('volume down works in fullscreen', applied?.audio?.volume === 0.9, `${applied?.audio?.volume}`)

  await page.keyboard.press('Alt+Shift+M')
  await page.waitForTimeout(350)
  applied = await pageState()
  check('mute works in fullscreen', applied?.audio?.muted === true)

  // The value must be shown inside the fullscreen element: a fullscreen element
  // is promoted to the top layer, where nothing outside it renders.
  const announced = await page.evaluate(() => {
    const fs = document.fullscreenElement
    if (!fs) return null
    const toast = [...fs.children].find((el) => el.textContent?.trim())
    return toast ? toast.textContent.trim() : null
  })
  check('the value is shown inside the fullscreen element', announced === 'Muted', String(announced))

  await page.keyboard.press('Alt+Shift+M')
  await page.waitForTimeout(300)
  check('unmute works in fullscreen', (await pageState())?.audio?.muted === false)

  await page.evaluate(() => document.exitFullscreen())
  await page.waitForTimeout(300)

  // ── manifest shape ────────────────────────────────────────────────────
  const manifest = await popup.evaluate(() => chrome.runtime.getManifest())
  check('the popup is the action', manifest.action?.default_popup === 'popup.html')
  check('four shortcuts are declared', Object.keys(manifest.commands ?? {}).length === 4)
  check(
    'only the permissions it needs',
    JSON.stringify(manifest.permissions) === JSON.stringify(['storage', 'tabs']),
    (manifest.permissions ?? []).join(', '),
  )
} finally {
  await ctx?.close()
  await new Promise((r) => server.close(r))
  await new Promise((r) => cdn.close(r))
  if (profile) await rm(profile, { recursive: true, force: true })
}

const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

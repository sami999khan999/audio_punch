/**
 * Headless smoke test: loads the built extension into a real Chromium and
 * checks the parts that only exist at runtime — the service worker starting,
 * the dashboard connecting to it, the content script answering, the overlay
 * reaching the page, and the audio engine document being created.
 *
 * Everything is driven from the dashboard page rather than from the service
 * worker directly: an extension page has the full chrome.* surface, and using
 * it exercises the real message port instead of reaching around it.
 *
 * Needs Playwright (`npm i -D playwright`) and a built `dist/chrome`.
 * Run with `npm run test:smoke`.
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/chrome', import.meta.url))
const checks = []

function check(name, passed, detail = '') {
  checks.push({ name, passed })
  console.log(`${passed ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

// Content scripts only match http(s), so the test page has to be served rather
// than handed over as a data: URL.
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(
    `<!doctype html><title>Audio Punch smoke</title>` +
      `<audio controls src="${SILENT_WAV}"></audio><p>fixture</p>`,
  )
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const TEST_PAGE = `http://127.0.0.1:${server.address().port}/`

let context
let profile

try {
  profile = await mkdtemp(join(tmpdir(), 'audio-punch-'))
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [
      '--headless=new',
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })

  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 })
  check('the service worker starts', Boolean(worker))

  const extensionId = new URL(worker.url()).host
  check('the extension gets an id', /^[a-p]{32}$/.test(extensionId), extensionId)

  // A page with a media element, so the content script has something to report.
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))
  await page.goto(TEST_PAGE)
  // document_idle, plus a moment for the media report to reach the worker.
  await page.waitForTimeout(700)

  // Checked explicitly and early: a throw during content-script setup takes the
  // message listener with it, and every later check then fails as an unhelpful
  // "receiving end does not exist". This has caught two temporal-dead-zone
  // bugs where state was read by a callback fired during construction.
  check('the content script loads without throwing', pageErrors.length === 0, pageErrors.join('; '))

  // The dashboard is our window into the extension.
  const dash = await context.newPage()
  const dashErrors = []
  dash.on('pageerror', (err) => dashErrors.push(err.message))
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html`)
  await dash.waitForSelector('.ap-page', { timeout: 10000 })

  check('the dashboard renders', (await dash.locator('.ap-panes .ap-tab').count()) === 4)
  check('the dashboard throws nothing', dashErrors.length === 0, dashErrors.join('; '))

  // Its status line only leaves "Reconnecting…" once the worker answers.
  await dash
    .waitForFunction(
      () => !document.querySelector('.ap-page-head .ap-label')?.textContent?.includes('Reconnect'),
      { timeout: 10000 },
    )
    .catch(() => {})
  const status = (await dash.locator('.ap-page-head .ap-label').last().textContent())?.trim()
  check('the dashboard connects to the worker', status !== 'Reconnecting…', status ?? '(none)')

  const stored = await dash.evaluate(async () => {
    const bag = await chrome.storage.local.get('audio-punch:settings')
    const settings = bag['audio-punch:settings']
    return { schema: settings?.schema ?? null, templates: settings?.templates?.length ?? 0 }
  })
  check('settings persist to storage', stored.schema === 1, `schema ${stored.schema}`)
  check('built-in templates are seeded', stored.templates > 0, `${stored.templates} templates`)

  const probe = await dash.evaluate(async () => {
    const tabs = await chrome.tabs.query({})
    const target = tabs.find((t) => (t.title ?? '').includes('Audio Punch smoke'))
    if (!target?.id) return { error: 'test page not found' }
    try {
      const reply = await chrome.tabs.sendMessage(target.id, { type: 'content:probe-media' })
      return { tabId: target.id, ...reply }
    } catch (err) {
      return { error: String(err) }
    }
  })
  check('the content script responds', probe?.ok === true, probe?.error ?? '')
  check('it finds the page media element', probe?.hasMedia === true, `${probe?.count ?? 0} found`)
  check(
    'the element is routed through the engine',
    probe?.hooked >= 1,
    `${probe?.hooked ?? 0} hooked`,
  )
  check('the page received its resolved chain', probe?.chain === true)

  if (probe.tabId !== undefined) {
    await dash.evaluate(async (tabId) => {
      await chrome.tabs.sendMessage(tabId, { type: 'content:open-overlay' })
    }, probe.tabId)
    await page.waitForTimeout(700)
  }

  const overlay = await page.evaluate(() => {
    const host = document.getElementById('audio-punch-overlay-host')
    return {
      present: Boolean(host),
      closedShadow: host ? host.shadowRoot === null : false,
      visible: host ? getComputedStyle(host).display !== 'none' : false,
    }
  })
  check('the overlay mounts into the page', overlay.present)
  check('its shadow root is closed to the page', overlay.closedShadow)
  check('it is visible once opened', overlay.visible)
  check('the overlay throws nothing on the page', pageErrors.length === 0, pageErrors.join('; '))

  // Changing a setting must survive the round trip to storage.
  const roundTrip = await dash.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: 'ui:patch-chain',
      target: 'global',
      patch: { gain: { level: 2.5, mute: false } },
    })
    await new Promise((resolve) => setTimeout(resolve, 600))
    const bag = await chrome.storage.local.get('audio-punch:settings')
    return bag['audio-punch:settings']?.global?.chain?.gain?.level ?? null
  })
  check('a chain change reaches storage', roundTrip === 2.5, `level ${roundTrip}`)

  // The engine now runs in the page, so there should be no offscreen document
  // and no tab-capture permission left behind.
  const engineDocs = await dash.evaluate(async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
    return contexts.length
  })
  check('no offscreen document is created', engineDocs === 0, `${engineDocs} offscreen`)

  const permissions = await dash.evaluate(() => chrome.runtime.getManifest().permissions ?? [])
  check(
    'tabCapture is no longer requested',
    !permissions.includes('tabCapture') && !permissions.includes('offscreen'),
    permissions.join(', '),
  )

  const worklets = await dash.evaluate(async () => {
    const results = await Promise.all(
      ['worklets/pitch-shifter.js', 'worklets/gate.js'].map(async (p) => {
        const res = await fetch(chrome.runtime.getURL(p))
        return res.ok
      }),
    )
    return results.every(Boolean)
  })
  check('the audio worklets are reachable', worklets)
} finally {
  await context?.close()
  await new Promise((resolve) => server.close(resolve))
  if (profile) await rm(profile, { recursive: true, force: true })
}

const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

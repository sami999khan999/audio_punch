/**
 * Import validation, migration and merge behaviour.
 *
 * Import is the one path where a bad input can destroy a user's work, so the
 * rule under test is: reject loudly, or apply completely — never halfway.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { applyImport, makeExport, migrate, validateImport } from '../src/shared/migrate.ts'
import { clampChain, defaultChain, defaultSettings, mergeChain } from '../src/shared/defaults.ts'
import { isDrmOrigin, isSupportedPage, originOf, prettyOrigin } from '../src/shared/origin.ts'
import { SCHEMA_VERSION } from '../src/shared/types.ts'

test('an export round-trips through import unchanged', () => {
  const settings = defaultSettings()
  settings.global.on = true
  settings.global.chain.gain.level = 2.5
  settings.sites['https://example.com'] = {
    origin: 'https://example.com',
    chain: defaultChain(),
    ignoreGlobal: true,
    snapshot: null,
    updatedAt: 1,
  }

  const envelope = makeExport(settings)
  const result = validateImport(JSON.parse(JSON.stringify(envelope)))
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.settings.global.chain.gain.level, 2.5)
  assert.equal(result.settings.sites['https://example.com']?.ignoreGlobal, true)
})

test('a bare settings object is accepted without an envelope', () => {
  const result = validateImport({ global: { on: true, chain: defaultChain() } })
  assert.equal(result.ok, true)
})

test('unrelated JSON is refused with a reason', () => {
  for (const payload of [42, 'nope', null, { hello: 'world' }]) {
    const result = validateImport(payload)
    assert.equal(result.ok, false, `should have refused ${JSON.stringify(payload)}`)
    if (!result.ok) assert.ok(result.error.length > 0)
  }
})

test("another app's export is refused by its app id", () => {
  const result = validateImport({ app: 'some-other-tool', settings: {} })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /audio-punch/)
})

test('out-of-range values are clamped rather than rejected', () => {
  const result = validateImport({
    global: { on: true, chain: { gain: { level: 9999, mute: false }, eq: { on: true, bands: [500] } } },
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.settings.global.chain.gain.level, 6)
  assert.equal(result.settings.global.chain.eq.bands.length, 10)
  assert.equal(result.settings.global.chain.eq.bands[0], 18)
})

test('a site key that is not an origin is dropped with a warning', () => {
  const { settings, warnings } = migrate({ sites: { 'not a url': { chain: defaultChain() } } })
  assert.equal(Object.keys(settings.sites).length, 0)
  assert.equal(warnings.length, 1)
})

test('a newer schema imports what it can and says so', () => {
  const { settings, warnings } = migrate({ schema: SCHEMA_VERSION + 5, global: { on: true } })
  assert.equal(settings.schema, SCHEMA_VERSION)
  assert.equal(settings.global.on, true)
  assert.ok(warnings.some((w) => /newer version/.test(w)))
})

test('bindings for actions that no longer exist are discarded', () => {
  const { settings } = migrate({ keymap: { 'gain.mute': ['x'], 'module.flux-capacitor': ['q'] } })
  assert.deepEqual(settings.keymap['gain.mute'], ['x'])
  assert.equal(settings.keymap['module.flux-capacitor'], undefined)
})

test('merge keeps existing sites and adds the incoming ones', () => {
  const current = defaultSettings()
  current.sites['https://keep.test'] = {
    origin: 'https://keep.test',
    chain: defaultChain(),
    ignoreGlobal: false,
    snapshot: null,
    updatedAt: 0,
  }
  const incoming = defaultSettings()
  incoming.sites['https://new.test'] = {
    origin: 'https://new.test',
    chain: defaultChain(),
    ignoreGlobal: false,
    snapshot: null,
    updatedAt: 0,
  }

  const merged = applyImport(current, incoming, 'merge')
  assert.ok(merged.sites['https://keep.test'])
  assert.ok(merged.sites['https://new.test'])

  const replaced = applyImport(current, incoming, 'replace')
  assert.equal(replaced.sites['https://keep.test'], undefined)
})

test('merging templates with the same name updates rather than duplicating', () => {
  const current = defaultSettings()
  current.templates = [
    { id: 'a', name: 'Night', description: 'old', modules: [], patch: {}, createdAt: 0, builtIn: false },
  ]
  const incoming = defaultSettings()
  incoming.templates = [
    { id: 'z', name: 'night', description: 'new', modules: [], patch: {}, createdAt: 0, builtIn: false },
  ]

  const merged = applyImport(current, incoming, 'merge')
  assert.equal(merged.templates.length, 1)
  assert.equal(merged.templates[0]!.description, 'new')
  assert.equal(merged.templates[0]!.id, 'a', 'the existing id is kept so applied snapshots still resolve')
})

test('a highpass above the lowpass is repaired, not left silent', () => {
  const chain = clampChain({ filter: { on: true, highpass: 18000, lowpass: 200, resonance: 1 } })
  assert.ok(chain.filter.highpass < chain.filter.lowpass)
})

test('mergeChain patches one module without restating the others', () => {
  const base = defaultChain()
  base.gain.level = 3
  const next = mergeChain(base, { tone: { on: true, bass: 4, treble: 0 } })
  assert.equal(next.gain.level, 3)
  assert.equal(next.tone.bass, 4)
})

test('origins identify a site by scheme, host and port', () => {
  assert.equal(originOf('https://youtube.com/watch?v=1'), 'https://youtube.com')
  assert.equal(originOf('https://music.youtube.com/x'), 'https://music.youtube.com')
  assert.equal(originOf('chrome://settings'), '')
  assert.equal(originOf(undefined), '')
  assert.equal(prettyOrigin('https://www.example.com'), 'example.com')
})

test('pages the overlay cannot reach are reported as unsupported', () => {
  assert.equal(isSupportedPage('https://example.com'), true)
  assert.equal(isSupportedPage('chrome://extensions'), false)
  assert.equal(isSupportedPage('https://chromewebstore.google.com/x'), false)
  assert.equal(isSupportedPage('https://example.com/manual.pdf'), false)
})

test('known protected-playback hosts are flagged before arming', () => {
  assert.equal(isDrmOrigin('https://www.netflix.com'), true)
  assert.equal(isDrmOrigin('https://open.spotify.com'), true)
  assert.equal(isDrmOrigin('https://example.com'), false)
})

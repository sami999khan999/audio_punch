/**
 * Template apply / remove and the one-level snapshot it depends on.
 *
 * The contract being pinned down here: removing a template always returns the
 * target to what it had before *any* template was applied, never to an
 * intermediate one.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { SettingsStore } from '../src/background/settings.ts'
import { fakePlatform } from './helpers.ts'
import type { ModuleId } from '../src/shared/types.ts'

async function store() {
  const s = new SettingsStore(fakePlatform())
  await s.load()
  return s
}

test('a new store seeds the built-in templates once', async () => {
  const s = await store()
  assert.ok(s.current().templates.length > 0)
  assert.ok(s.current().templates.every((t) => t.builtIn))
})

test('saving a template captures only the modules asked for', async () => {
  const s = await store()
  s.patchChain('global', { tone: { on: true, bass: 6, treble: -2 }, reverb: { on: true, mix: 0.5, size: 2, decay: 2, damping: 0.4 } })

  const template = s.saveTemplate('Warm', 'test', ['tone'] as ModuleId[], 'global')
  assert.deepEqual(Object.keys(template.patch), ['tone'])
  assert.equal(template.patch.tone?.bass, 6)
})

test('applying a template merges its modules and leaves the rest alone', async () => {
  const s = await store()
  s.patchChain('global', { gain: { level: 3, mute: false } })
  const template = s.saveTemplate('Bass', '', ['tone'] as ModuleId[], 'global')
  s.patchChain('global', { tone: { on: true, bass: 9, treble: 0 } })
  s.applyTemplate(template.id, 'global')

  const chain = s.current().global.chain
  assert.equal(chain.gain.level, 3, 'an untouched module must survive')
  assert.equal(chain.tone.bass, 0, 'the template value must win')
})

test('removing a template restores the pre-template chain exactly', async () => {
  const s = await store()

  // Capture a template that darkens the tone.
  s.patchChain('global', { tone: { on: true, bass: -6, treble: -4 } })
  const template = s.saveTemplate('Dark', '', ['tone'] as ModuleId[], 'global')

  // Now set up a different chain, and remember it.
  s.patchChain('global', { tone: { on: true, bass: 5, treble: 1 }, gain: { level: 2, mute: false } })
  const before = structuredClone(s.current().global.chain)

  s.applyTemplate(template.id, 'global')
  assert.equal(s.current().global.chain.tone.bass, -6)
  assert.notDeepEqual(s.current().global.chain, before)

  s.removeTemplate('global')
  assert.deepEqual(s.current().global.chain, before)
  assert.equal(s.current().global.snapshot, null)
})

test('a second template replaces the snapshot rather than stacking', async () => {
  const s = await store()
  s.patchChain('global', { gain: { level: 1.5, mute: false } })
  const original = structuredClone(s.current().global.chain)

  const quiet = s.saveTemplate('Quiet', '', ['gain'] as ModuleId[], 'global')
  s.patchChain('global', { gain: { level: 0.3, mute: false } })
  const loud = s.saveTemplate('Loud', '', ['gain'] as ModuleId[], 'global')

  s.patchChain('global', { gain: { level: 1.5, mute: false } })
  s.applyTemplate(quiet.id, 'global')
  s.applyTemplate(loud.id, 'global')
  assert.equal(s.current().global.chain.gain.level, 0.3)

  s.removeTemplate('global')
  assert.deepEqual(
    s.current().global.chain,
    original,
    'removal must skip past the first template, not land on it',
  )
})

test('templates apply per-target and do not leak between sites', async () => {
  const s = await store()
  const template = s.saveTemplate('Muted', '', ['gain'] as ModuleId[], 'global')
  s.patchChain('site:https://a.test', { gain: { level: 4, mute: false } })
  s.patchChain('site:https://b.test', { gain: { level: 5, mute: false } })

  s.applyTemplate(template.id, 'site:https://a.test')
  assert.equal(s.current().sites['https://a.test']!.chain.gain.level, 1)
  assert.equal(s.current().sites['https://b.test']!.chain.gain.level, 5)

  s.removeTemplate('site:https://a.test')
  assert.equal(s.current().sites['https://a.test']!.chain.gain.level, 4)
})

test('deleting an applied template clears the dangling snapshot', async () => {
  const s = await store()
  const template = s.saveTemplate('Temp', '', ['tone'] as ModuleId[], 'global')
  s.applyTemplate(template.id, 'global')
  assert.ok(s.current().global.snapshot)

  s.deleteTemplate(template.id)
  assert.equal(s.current().global.snapshot, null)
})

test('applying a template that no longer exists is refused, not silent', async () => {
  const s = await store()
  assert.throws(() => s.applyTemplate('does-not-exist', 'global'), /no longer exists/)
})

test('resetting a target clears both its chain and its snapshot', async () => {
  const s = await store()
  const template = s.saveTemplate('Temp', '', ['tone'] as ModuleId[], 'global')
  s.patchChain('global', { gain: { level: 4, mute: true } })
  s.applyTemplate(template.id, 'global')

  s.resetChain('global')
  assert.equal(s.current().global.chain.gain.level, 1)
  assert.equal(s.current().global.snapshot, null)
})

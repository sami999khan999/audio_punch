/**
 * The volume rules.
 *
 * These are the parts that fail quietly rather than loudly: a value that drifts
 * past its limits, a nudge that silently does nothing, or a global switch that
 * eats the per-site settings it was supposed to leave alone.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { clampVolume, defaultSettings, formatVolume, readSettings } from '../src/shared/defaults.ts'
import { MAX_VOLUME, VOLUME_STEP } from '../src/shared/types.ts'
import { nudge, readScope, resolveAudio, scopeFor, writeScope } from '../src/background/resolve.ts'

const SITE = 'https://example.com'

test('volume is held inside its range', () => {
  assert.equal(clampVolume(-5), 0)
  assert.equal(clampVolume(99), MAX_VOLUME)
  assert.equal(clampVolume(1.5), 1.5)
})

test('a non-number falls back to untouched rather than to silence', () => {
  assert.equal(clampVolume(undefined), 1)
  assert.equal(clampVolume(Number.NaN), 1)
  assert.equal(clampVolume('loud'), 1)
})

test('repeated nudges do not drift off the step', () => {
  let audio = { volume: 1, muted: false }
  for (let i = 0; i < 10; i++) audio = nudge(audio, 1)
  assert.equal(audio.volume, 2, 'ten steps of 0.1 from 1.0 should land exactly on 2.0')
})

test('nudging down stops at zero, not below', () => {
  let audio = { volume: 0.2, muted: false }
  for (let i = 0; i < 10; i++) audio = nudge(audio, -1)
  assert.equal(audio.volume, 0)
})

test('nudging up stops at the ceiling', () => {
  let audio = { volume: MAX_VOLUME - VOLUME_STEP, muted: false }
  audio = nudge(audio, 1)
  audio = nudge(audio, 1)
  assert.equal(audio.volume, MAX_VOLUME)
})

test('turning the volume up while muted unmutes', () => {
  const audio = nudge({ volume: 0.5, muted: true }, 1)
  assert.equal(audio.muted, false, 'volume up must produce sound, not a louder silence')
  assert.equal(audio.volume, 0.6)
})

test('turning the volume down while muted leaves it muted', () => {
  assert.equal(nudge({ volume: 0.5, muted: true }, -1).muted, true)
})

test('an unknown site plays untouched', () => {
  assert.deepEqual(resolveAudio(defaultSettings(), 'https://nowhere.test'), {
    volume: 1,
    muted: false,
  })
})

test('with global off a site hears its own volume', () => {
  const settings = defaultSettings()
  writeScope(settings, 'site', SITE, { volume: 2 })
  assert.deepEqual(resolveAudio(settings, SITE), { volume: 2, muted: false })
})

test('with global on every site hears the global volume', () => {
  const settings = defaultSettings()
  writeScope(settings, 'site', SITE, { volume: 2 })
  settings.globalOn = true
  writeScope(settings, 'global', SITE, { volume: 0.5 })

  assert.deepEqual(resolveAudio(settings, SITE), { volume: 0.5, muted: false })
  assert.deepEqual(resolveAudio(settings, 'https://other.test'), { volume: 0.5, muted: false })
})

test('turning global off restores per-site volumes untouched', () => {
  const settings = defaultSettings()
  writeScope(settings, 'site', SITE, { volume: 2 })

  settings.globalOn = true
  writeScope(settings, 'global', SITE, { volume: 0.3 })
  assert.equal(resolveAudio(settings, SITE).volume, 0.3)

  settings.globalOn = false
  assert.equal(resolveAudio(settings, SITE).volume, 2, 'the site value must have survived')
})

test('the editable scope follows the global switch', () => {
  const settings = defaultSettings()
  assert.equal(scopeFor(settings), 'site')
  settings.globalOn = true
  assert.equal(scopeFor(settings), 'global')
})

test('muting one site does not mute another', () => {
  const settings = defaultSettings()
  writeScope(settings, 'site', SITE, { muted: true })
  assert.equal(resolveAudio(settings, SITE).muted, true)
  assert.equal(resolveAudio(settings, 'https://other.test').muted, false)
})

test('writing a site preserves the field it was not given', () => {
  const settings = defaultSettings()
  writeScope(settings, 'site', SITE, { volume: 3 })
  writeScope(settings, 'site', SITE, { muted: true })
  assert.deepEqual(readScope(settings, 'site', SITE), { volume: 3, muted: true })
})

test('stored settings are rebuilt rather than trusted', () => {
  const settings = readSettings({
    globalOn: 'yes',
    global: { volume: 900, muted: 1 },
    sites: {
      'https://ok.test': { volume: 2, muted: true },
      'not-a-url': { volume: 2 },
    },
    somethingElse: 'dropped',
  })
  assert.equal(settings.globalOn, false, 'only a real boolean turns global on')
  assert.equal(settings.global.volume, MAX_VOLUME)
  assert.equal(settings.global.muted, false, 'only a real boolean mutes')
  assert.equal(Object.keys(settings.sites).length, 1)
  assert.equal((settings as unknown as Record<string, unknown>).somethingElse, undefined)
})

test('volume formats as a percentage', () => {
  assert.equal(formatVolume(1), '100%')
  assert.equal(formatVolume(0), '0%')
  assert.equal(formatVolume(2.5), '250%')
})

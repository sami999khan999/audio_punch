/**
 * The global-versus-per-site rule. This is the behaviour most likely to be
 * quietly broken by a later change, and the hardest to notice by ear.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { resolve, resolveChain } from '../src/background/resolve.ts'
import { defaultChain, defaultSettings } from '../src/shared/defaults.ts'
import type { Settings } from '../src/shared/types.ts'

const SITE = 'https://example.com'

function withSite(settings: Settings, ignoreGlobal = false): Settings {
  const chain = defaultChain()
  chain.gain.level = 2
  settings.sites[SITE] = {
    origin: SITE,
    chain,
    ignoreGlobal,
    snapshot: null,
    updatedAt: 0,
  }
  return settings
}

test('an unknown site gets the default chain', () => {
  const result = resolve(defaultSettings(), 'https://nowhere.test')
  assert.equal(result.source, 'default')
  assert.deepEqual(result.chain, defaultChain())
})

test('with global off, a site hears its own chain', () => {
  const settings = withSite(defaultSettings())
  const result = resolve(settings, SITE)
  assert.equal(result.source, 'site')
  assert.equal(result.chain.gain.level, 2)
})

test('with global on, a site hears the global chain', () => {
  const settings = withSite(defaultSettings())
  settings.global.on = true
  settings.global.chain.gain.level = 0.5
  const result = resolve(settings, SITE)
  assert.equal(result.source, 'global')
  assert.equal(result.chain.gain.level, 0.5)
})

test('a pinned site keeps its own chain while global is on', () => {
  const settings = withSite(defaultSettings(), true)
  settings.global.on = true
  settings.global.chain.gain.level = 0.5
  const result = resolve(settings, SITE)
  assert.equal(result.source, 'site')
  assert.equal(result.chain.gain.level, 2)
})

test('turning global off restores per-site settings untouched', () => {
  const settings = withSite(defaultSettings())
  settings.global.on = true
  settings.global.chain.gain.level = 0.5
  resolveChain(settings, SITE)

  settings.global.on = false
  assert.equal(resolveChain(settings, SITE).gain.level, 2, 'the site chain must survive global')
  assert.equal(settings.sites[SITE]!.chain.gain.level, 2, 'and must not have been rewritten')
})

test('mute-all and bypass-all fold over the resolved chain without storing', () => {
  const settings = withSite(defaultSettings())
  settings.muteAll = true
  settings.bypassAll = true

  const resolved = resolveChain(settings, SITE)
  assert.equal(resolved.gain.mute, true)
  assert.equal(resolved.bypass, true)

  // Releasing them must return the site to its own state, not to "unmuted".
  assert.equal(settings.sites[SITE]!.chain.gain.mute, false)
  assert.equal(settings.sites[SITE]!.chain.bypass, false)

  settings.muteAll = false
  settings.bypassAll = false
  const released = resolveChain(settings, SITE)
  assert.equal(released.gain.mute, false)
  assert.equal(released.bypass, false)
})

test('the resolved chain is a copy, so callers cannot mutate stored state', () => {
  const settings = withSite(defaultSettings())
  const resolved = resolveChain(settings, SITE)
  resolved.gain.level = 99
  assert.equal(settings.sites[SITE]!.chain.gain.level, 2)
})

/**
 * Silence detection.
 *
 * The engine warns when a routed element plays but no signal arrives — that is
 * how cross-origin media without CORS headers fails, silently and without
 * throwing. The rule under test is that it must never fire for silence the
 * user asked for.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { defaultChain } from '../src/shared/defaults.ts'
import type { ChainState } from '../src/shared/types.ts'

/**
 * Mirrors the guard in ContentEngine.readLevel. Kept as a pure function here
 * because the engine itself needs an AudioContext, which Node has no business
 * providing.
 */
function silencedByChain(chain: ChainState | null): boolean {
  return chain !== null && (chain.gain.mute || chain.gain.level === 0)
}

test('a muted chain is not reported as lost signal', () => {
  const chain = defaultChain()
  chain.gain.mute = true
  assert.equal(silencedByChain(chain), true)
})

test('a chain closed to zero is not reported as lost signal', () => {
  const chain = defaultChain()
  chain.gain.level = 0
  assert.equal(silencedByChain(chain), true)
})

test('an ordinary chain does not suppress the warning', () => {
  assert.equal(silencedByChain(defaultChain()), false)
})

test('a bypassed chain still passes audio, so it does not suppress it', () => {
  const chain = defaultChain()
  chain.bypass = true
  assert.equal(silencedByChain(chain), false)
})

test('no chain yet means nothing to suppress', () => {
  assert.equal(silencedByChain(null), false)
})

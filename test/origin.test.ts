/**
 * Site identity, which decides what a "per site" setting applies to.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { originOf, prettyOrigin } from '../src/shared/origin.ts'

test('an origin is scheme, host and port', () => {
  assert.equal(originOf('https://youtube.com/watch?v=1'), 'https://youtube.com')
  assert.equal(originOf('http://localhost:8080/x'), 'http://localhost:8080')
})

test('subdomains are their own site', () => {
  assert.notEqual(originOf('https://music.youtube.com/'), originOf('https://youtube.com/'))
})

test('pages no content script can reach have no origin', () => {
  for (const url of ['chrome://settings', 'about:blank', 'file:///tmp/a.html', undefined, '']) {
    assert.equal(originOf(url), '', String(url))
  }
  assert.equal(originOf('https://chromewebstore.google.com/x'), '')
  assert.equal(originOf('https://example.com/manual.pdf'), '')
})

test('origins display without the www', () => {
  assert.equal(prettyOrigin('https://www.example.com'), 'example.com')
  assert.equal(prettyOrigin(''), 'This page')
})

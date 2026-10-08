/**
 * Shortcut strings arrive in two spellings — the browser's display names and
 * the KeyboardEvent codes the popup records — and have to compare as equal.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COMMANDS,
  DEFAULT_BINDINGS,
  needsTypingGuard,
  parseShortcut,
  prettyShortcut,
  sameShortcut,
  shortcutFromEvent,
} from '../src/shared/keys.ts'
import { readSettings } from '../src/shared/defaults.ts'

function keydown(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init } as KeyboardEvent
}

test("the browser's spelling and the recorder's are the same key", () => {
  assert.ok(sameShortcut('Alt+Shift+Up Arrow', 'Alt+Shift+ArrowUp'))
  assert.ok(sameShortcut('Alt+Shift+Up', 'Alt+Shift+ArrowUp'))
  assert.ok(sameShortcut('Alt+Shift+M', 'Shift+Alt+KeyM'))
  assert.ok(sameShortcut('Ctrl+5', 'Ctrl+Digit5'))
})

test('different modifiers are different keys', () => {
  assert.ok(!sameShortcut('Alt+Shift+M', 'Alt+M'))
  assert.ok(!sameShortcut('Ctrl+M', 'Command+M'))
})

test('a keypress is recorded as modifiers and a code', () => {
  assert.equal(shortcutFromEvent(keydown({ code: 'KeyK', altKey: true, shiftKey: true })), 'Alt+Shift+KeyK')
  assert.equal(shortcutFromEvent(keydown({ code: 'F7' })), 'F7')
})

test('a modifier on its own is not yet a shortcut', () => {
  assert.equal(shortcutFromEvent(keydown({ code: 'ShiftLeft', shiftKey: true })), null)
  assert.equal(shortcutFromEvent(keydown({ code: 'AltRight', altKey: true })), null)
})

test('shortcuts display without the code prefixes', () => {
  assert.equal(prettyShortcut('Alt+Shift+KeyK'), 'Alt+Shift+K')
  assert.equal(prettyShortcut('Alt+Shift+Up Arrow'), 'Alt+Shift+↑')
  assert.equal(prettyShortcut('Ctrl+Digit0'), 'Ctrl+0')
})

test('a trailing plus is not a shortcut', () => {
  assert.equal(parseShortcut(''), null)
})

test('stored bindings are kept, including an unassigned one', () => {
  const settings = readSettings({ bindings: { 'volume-up': 'Alt+KeyK', reset: '' } })
  assert.deepEqual(settings.bindings, { 'volume-up': 'Alt+KeyK', reset: '' })
})

test('stored bindings for unknown commands or of the wrong type are dropped', () => {
  const settings = readSettings({ bindings: { 'self-destruct': 'Alt+KeyX', 'volume-down': 7 } })
  assert.deepEqual(settings.bindings, {})
})

test('every command has a default key, and no two share one', () => {
  for (const command of COMMANDS) {
    const parsed = parseShortcut(DEFAULT_BINDINGS[command])
    assert.ok(parsed, command)
    assert.ok(!needsTypingGuard(parsed), `${command} would fire while typing`)
  }
  const keys = COMMANDS.map((c) => DEFAULT_BINDINGS[c])
  for (const [i, key] of keys.entries()) {
    assert.ok(!keys.slice(i + 1).some((other) => sameShortcut(key, other)), key)
  }
})

test('the volume defaults are Alt+Shift and the arrows', () => {
  assert.ok(sameShortcut(DEFAULT_BINDINGS['volume-up'], 'Alt+Shift+Up'))
  assert.ok(sameShortcut(DEFAULT_BINDINGS['volume-down'], 'Alt+Shift+Down'))
})

/**
 * Shortcut parsing and dispatch.
 *
 * The catalogue/defaults cross-check is the useful one here: it fails the
 * moment an action is added without a binding, or a binding survives an action
 * being removed — both of which are silent at runtime.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACTION_CATALOG,
  acceleratorFromEvent,
  createKeymap,
  formatAccelerator,
  parseAccelerator,
} from '../src/content/keymap.ts'
import { DEFAULT_KEYMAP } from '../src/shared/defaults.ts'
import type { MixerActions } from '../src/ui/views/mixer.ts'

/** A KeyboardEvent stand-in; the keymap only reads these five fields. */
function key(
  k: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {},
): KeyboardEvent {
  return {
    key: k,
    ctrlKey: mods.ctrl === true,
    altKey: mods.alt === true,
    shiftKey: mods.shift === true,
    metaKey: mods.meta === true,
  } as KeyboardEvent
}

function recorder(): { actions: MixerActions; calls: string[] } {
  const calls: string[] = []
  const note =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(args.length > 0 ? `${name}(${args.join(',')})` : name)
    }
  const actions = {
    selectRelative: note('selectRelative'),
    selectGlobal: note('selectGlobal'),
    patch: note('patch'),
    toggleModule: note('toggleModule'),
    toggleBypass: note('toggleBypass'),
    nudgeGain: note('nudgeGain'),
    toggleMute: note('toggleMute'),
    moveEqBand: note('moveEqBand'),
    nudgeEqBand: note('nudgeEqBand'),
    flattenEq: note('flattenEq'),
    resetTarget: note('resetTarget'),
    toggleIgnoreGlobal: note('toggleIgnoreGlobal'),
    toggleGlobal: note('toggleGlobal'),
    armSelected: note('armSelected'),
    applyTemplateSlot: note('applyTemplateSlot'),
    removeTemplate: note('removeTemplate'),
    openDashboard: note('openDashboard'),
  } as unknown as MixerActions
  return { actions, calls }
}

test('every default binding names an action in the catalogue', () => {
  const known = new Set(ACTION_CATALOG.map((a) => a.id))
  for (const id of Object.keys(DEFAULT_KEYMAP)) {
    assert.ok(known.has(id), `${id} is bound but not listed in the catalogue`)
  }
})

test('every catalogued action has a default binding', () => {
  for (const action of ACTION_CATALOG) {
    assert.ok(DEFAULT_KEYMAP[action.id], `${action.id} is listed but has no default binding`)
  }
})

test('no two default bindings claim the same key', () => {
  const seen = new Map<string, string>()
  for (const [id, accelerators] of Object.entries(DEFAULT_KEYMAP)) {
    for (const accelerator of accelerators) {
      const clash = seen.get(accelerator)
      assert.equal(clash, undefined, `${accelerator} is bound to both ${clash} and ${id}`)
      seen.set(accelerator, id)
    }
  }
})

test('accelerators parse their modifiers', () => {
  assert.deepEqual(parseAccelerator('Ctrl+1'), { key: '1', ctrl: true, alt: false, shift: false })
  assert.deepEqual(parseAccelerator('Shift+ArrowUp'), {
    key: 'ArrowUp',
    ctrl: false,
    alt: false,
    shift: true,
  })
  assert.deepEqual(parseAccelerator('?'), { key: '?', ctrl: false, alt: false, shift: false })
})

test('a key press converts back to an accelerator', () => {
  assert.equal(acceleratorFromEvent(key('M')), 'm')
  assert.equal(acceleratorFromEvent(key('1', { ctrl: true })), 'Ctrl+1')
  assert.equal(acceleratorFromEvent(key('ArrowUp', { shift: true })), 'Shift+ArrowUp')
  // Cmd on a Mac binds the same as Ctrl.
  assert.equal(acceleratorFromEvent(key('d', { meta: true })), 'Ctrl+d')
  assert.equal(acceleratorFromEvent(key('Shift')), null, 'a bare modifier is not a binding')
})

test('accelerators format for display', () => {
  assert.equal(formatAccelerator('Ctrl+1'), 'Ctrl + 1')
  assert.equal(formatAccelerator('Shift+ArrowUp'), 'Shift + ↑')
  assert.equal(formatAccelerator('Escape'), 'Esc')
})

test('a bound key runs its action and reports that it was consumed', () => {
  const { actions, calls } = recorder()
  const dispatch = createKeymap({
    actions,
    keymap: () => DEFAULT_KEYMAP,
    onHelp: () => calls.push('help'),
    onClose: () => calls.push('close'),
  })

  assert.equal(dispatch(key('m')), true)
  assert.deepEqual(calls, ['toggleMute'])

  assert.equal(dispatch(key('Escape')), true)
  assert.equal(calls.at(-1), 'close')

  assert.equal(dispatch(key('3', { ctrl: true })), true)
  assert.equal(calls.at(-1), 'applyTemplateSlot(2)', 'Ctrl+3 is template slot three')
})

test('an unbound key is left for the page', () => {
  const { actions } = recorder()
  const dispatch = createKeymap({
    actions,
    keymap: () => DEFAULT_KEYMAP,
    onHelp: () => {},
    onClose: () => {},
  })
  assert.equal(dispatch(key('z', { ctrl: true, alt: true })), false)
})

test('a modifier distinguishes coarse from fine on the same key', () => {
  const { actions, calls } = recorder()
  const dispatch = createKeymap({
    actions,
    keymap: () => DEFAULT_KEYMAP,
    onHelp: () => {},
    onClose: () => {},
  })

  dispatch(key('ArrowUp'))
  assert.equal(calls.at(-1), 'nudgeGain(1)')

  dispatch(key('ArrowUp', { shift: true }))
  assert.equal(calls.at(-1), 'nudgeGain(0.2)', 'Shift must reach the fine binding, not the coarse one')
})

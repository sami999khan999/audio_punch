/**
 * Source selection across state broadcasts.
 *
 * Regression: selecting Global used to be undone by the very next snapshot,
 * because the "default to the tab I am running in" rule re-ran every time.
 * Global was therefore impossible to edit.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { defaultSettings } from '../src/shared/defaults.ts'
import type { StateSnapshot, TabInfo, TargetKey } from '../src/shared/types.ts'

function tab(tabId: number, origin: string): TabInfo {
  return {
    tabId,
    windowId: 1,
    origin,
    title: origin,
    favIconUrl: '',
    audible: true,
    active: false,
    hasMediaElements: true,
    hooked: 1,
    silent: false,
  }
}

function snapshot(tabs: TabInfo[], selfTabId: number | null): StateSnapshot {
  return { settings: defaultSettings(), tabs, selfTabId, engineReady: true }
}

/** The reconciliation rule from UiStore, isolated from chrome.runtime. */
function reconcile(
  state: { target: TargetKey; targetTabId: number | null; chosen: boolean },
  snap: StateSnapshot,
): { target: TargetKey; targetTabId: number | null } {
  const { target, targetTabId } = state
  if (targetTabId !== null && snap.tabs.some((t) => t.tabId === targetTabId)) {
    return { target, targetTabId }
  }
  if (state.chosen) {
    if (target === 'global') return { target: 'global', targetTabId: null }
    const origin = target.slice('site:'.length)
    const reopened = snap.tabs.find((t) => t.origin === origin)
    return reopened ? { target, targetTabId: reopened.tabId } : { target, targetTabId: null }
  }
  const own = snap.tabs.find((t) => t.tabId === snap.selfTabId)
  if (own) return { target: `site:${own.origin}`, targetTabId: own.tabId }
  return { target: 'global', targetTabId: null }
}

const TABS = [tab(1, 'https://a.test'), tab(2, 'https://b.test')]

test('with nothing chosen it opens on the tab it is running in', () => {
  const result = reconcile({ target: 'global', targetTabId: null, chosen: false }, snapshot(TABS, 2))
  assert.deepEqual(result, { target: 'site:https://b.test', targetTabId: 2 })
})

test('choosing global survives the next broadcast', () => {
  const result = reconcile({ target: 'global', targetTabId: null, chosen: true }, snapshot(TABS, 2))
  assert.deepEqual(result, { target: 'global', targetTabId: null })
})

test('choosing global survives repeated broadcasts', () => {
  let state = { target: 'global' as TargetKey, targetTabId: null as number | null, chosen: true }
  for (let i = 0; i < 5; i++) {
    state = { ...state, ...reconcile(state, snapshot(TABS, 2)) }
  }
  assert.equal(state.target, 'global')
})

test('a selected tab that still exists is kept', () => {
  const result = reconcile(
    { target: 'site:https://a.test', targetTabId: 1, chosen: true },
    snapshot(TABS, 2),
  )
  assert.deepEqual(result, { target: 'site:https://a.test', targetTabId: 1 })
})

test('a chosen site whose tab closed stays selected, editable by origin', () => {
  const result = reconcile(
    { target: 'site:https://gone.test', targetTabId: 9, chosen: true },
    snapshot(TABS, 2),
  )
  assert.deepEqual(result, { target: 'site:https://gone.test', targetTabId: null })
})

test('a chosen site reattaches when its tab comes back', () => {
  const result = reconcile(
    { target: 'site:https://a.test', targetTabId: null, chosen: true },
    snapshot(TABS, 2),
  )
  assert.deepEqual(result, { target: 'site:https://a.test', targetTabId: 1 })
})

test('with no tabs at all it falls back to global', () => {
  const result = reconcile({ target: 'global', targetTabId: null, chosen: false }, snapshot([], null))
  assert.deepEqual(result, { target: 'global', targetTabId: null })
})

/**
 * Which volume a page actually plays at, and how a change is routed.
 *
 * Kept pure and dependency-free so it can be reasoned about and tested on its
 * own. The whole rule:
 *
 *   - Global off -> the site's own setting.
 *   - Global on  -> the global setting, and per-site values are left untouched
 *                   so turning global off restores every tab exactly.
 */
import { clampVolume, defaultAudio } from '../shared/defaults.ts'
import { VOLUME_STEP, type AudioState, type Settings } from '../shared/types.ts'
import type { Scope } from '../shared/messages.ts'

export function resolveAudio(settings: Settings, origin: string): AudioState {
  if (settings.globalOn) return { ...settings.global }
  const site = settings.sites[origin]
  return site ? { volume: site.volume, muted: site.muted } : defaultAudio()
}

/**
 * The setting a control edits. With global on, the popup and the shortcuts act
 * on the global value — adjusting a site you cannot hear would be a trap.
 */
export function scopeFor(settings: Settings): Scope {
  return settings.globalOn ? 'global' : 'site'
}

export function readScope(settings: Settings, scope: Scope, origin: string): AudioState {
  if (scope === 'global') return { ...settings.global }
  const site = settings.sites[origin]
  return site ? { volume: site.volume, muted: site.muted } : defaultAudio()
}

/** Applies a change in place and returns the new value. */
export function writeScope(
  settings: Settings,
  scope: Scope,
  origin: string,
  patch: Partial<AudioState>,
): AudioState {
  if (scope === 'global') {
    settings.global = {
      volume: clampVolume(patch.volume ?? settings.global.volume),
      muted: patch.muted ?? settings.global.muted,
    }
    return { ...settings.global }
  }

  const current = settings.sites[origin]
  const next = {
    origin,
    volume: clampVolume(patch.volume ?? current?.volume ?? 1),
    muted: patch.muted ?? current?.muted ?? false,
    updatedAt: Date.now(),
  }
  settings.sites[origin] = next
  return { volume: next.volume, muted: next.muted }
}

/**
 * Nudging up from muted unmutes rather than raising a value nobody can hear —
 * pressing volume-up and getting silence is the wrong answer.
 */
export function nudge(current: AudioState, steps: number): AudioState {
  const volume = clampVolume(current.volume + steps * VOLUME_STEP)
  if (steps > 0 && current.muted) return { volume, muted: false }
  return { volume, muted: current.muted }
}

/**
 * Whether a pushed value is still current for the page receiving it.
 *
 * The page moves its own audio the moment a shortcut is pressed rather than
 * waiting for the worker to answer, so a push can arrive describing a press the
 * page has already moved past. Taking it would step the volume back and then
 * forward again — an audible wobble on exactly the fast presses this is meant
 * to smooth out.
 *
 * `seq` is the press the push answers; `applied` is how many presses the page
 * has taken itself. A push with no `seq` did not come from a press at all (a
 * navigation, the popup, another window) and is always current.
 */
export function pushIsCurrent(seq: number | undefined, applied: number): boolean {
  if (seq === undefined) return true
  return seq >= applied
}

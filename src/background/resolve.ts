/**
 * Which chain a given site actually hears.
 *
 * This is the whole global-versus-per-site rule, kept pure and dependency-free
 * so it can be reasoned about and tested on its own:
 *
 *   - Global off            -> the site's own chain.
 *   - Global on             -> the global chain.
 *   - Global on, site pinned
 *     to "ignore global"    -> the site's own chain.
 *
 * Per-site settings are never destroyed by turning global on; they are simply
 * not consulted, so switching global off restores every tab exactly.
 */
import { defaultChain, cloneChain } from '../shared/defaults.ts'
import type { ChainState, Settings } from '../shared/types.ts'

export type ChainSource = 'global' | 'site' | 'default'

export interface Resolution {
  chain: ChainState
  source: ChainSource
}

export function resolve(settings: Settings, origin: string): Resolution {
  const site = settings.sites[origin]
  const globalWins = settings.global.on && !site?.ignoreGlobal

  if (globalWins) {
    return { chain: withMasters(settings, settings.global.chain), source: 'global' }
  }
  if (site) {
    return { chain: withMasters(settings, site.chain), source: 'site' }
  }
  return { chain: withMasters(settings, defaultChain()), source: 'default' }
}

/** Convenience wrapper when only the chain is wanted. */
export function resolveChain(settings: Settings, origin: string): ChainState {
  return resolve(settings, origin).chain
}

/**
 * Folds the two latching browser commands over whatever chain was resolved.
 * They are deliberately not stored into any chain: releasing mute-all must
 * return every tab to its own mute state, not to "unmuted".
 */
function withMasters(settings: Settings, chain: ChainState): ChainState {
  if (!settings.muteAll && !settings.bypassAll) return cloneChain(chain)
  const next = cloneChain(chain)
  if (settings.bypassAll) next.bypass = true
  if (settings.muteAll) next.gain.mute = true
  return next
}


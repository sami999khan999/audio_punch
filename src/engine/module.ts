/**
 * Common shape for every processing module in a tab's graph.
 *
 * A module is a self-contained sub-graph with one input and one output. The
 * graph asks each module whether it is active; inactive modules are unlinked
 * entirely rather than neutralised, so an unused reverb costs nothing.
 */
import type { ChainState, ModuleId } from '../shared/types.ts'

export interface ChainModule {
  readonly id: ModuleId
  readonly input: AudioNode
  readonly output: AudioNode
  /** Pushes the current parameter values onto the live nodes. */
  update(chain: ChainState, now: number): void
  /** Whether this module should be linked into the signal path at all. */
  isActive(chain: ChainState): boolean
  dispose(): void
}

/** Time constant for parameter ramps — short enough to feel instant, long
 *  enough that dragging a knob does not produce zipper noise. */
export const RAMP_SECONDS = 0.02

export function ramp(param: AudioParam, value: number, now: number): void {
  if (!Number.isFinite(value)) return
  // setTargetAtTime avoids the scheduling pile-up that repeated
  // linearRampToValueAtTime calls cause during a knob drag.
  param.setTargetAtTime(value, now, RAMP_SECONDS / 3)
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}


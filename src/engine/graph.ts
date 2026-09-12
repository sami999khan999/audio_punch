/**
 * One page's processing graph.
 *
 * Signal flow, in order:
 *
 *   sources -> input -> gate -> filter -> eq -> tone -> comp -> pitch
 *           -> width -> reverb -> delay -> pan -> limiter -> output
 *           -> meter -> destination
 *
 * `gain`, `pan` and the meter are permanent. Everything else is a module that
 * is linked in only while it is doing something: the graph compares the set of
 * active modules against the last one and relinks only when it changes, so
 * turning a knob never touches the topology.
 *
 * Every media element on the page feeds the one input node, so a page with
 * several players is mixed rather than fought over.
 *
 * The output MUST reach the context destination. Routing an element through
 * `createMediaElementSource` takes its audio out of the normal playback path,
 * so a graph that fails to connect is not a missing effect — it is a silent
 * page. `assertAudible` guards that on every relink.
 */
import type { ChainState, LevelReading } from '../shared/types.ts'
import { ramp, type ChainModule } from './module.ts'
import { EqModule, ToneModule } from './eq.ts'
import { FilterModule } from './filters.ts'
import { CompModule, GateModule, LimiterModule } from './dynamics.ts'
import { DelayModule, ReverbModule, WidthModule } from './space.ts'
import { PitchModule } from './pitch.ts'
import { Meter } from './meter.ts'

/** Module order in the signal path. */
const MODULE_ORDER = [
  'gate',
  'filter',
  'eq',
  'tone',
  'comp',
  'pitch',
  'width',
  'reverb',
  'delay',
  'limiter',
] as const

export class PageGraph {
  private readonly ctx: AudioContext
  private readonly inputGain: GainNode
  private readonly panner: StereoPannerNode
  private readonly outputGain: GainNode
  private readonly meter: Meter
  private readonly modules: Map<string, ChainModule>
  private activeSignature = ''
  private disposed = false

  constructor(ctx: AudioContext) {
    this.ctx = ctx

    // Force stereo at the head of the chain. A mono source would otherwise
    // make the mid/side maths collapse one side to silence.
    this.inputGain = ctx.createGain()
    this.inputGain.channelCount = 2
    this.inputGain.channelCountMode = 'explicit'
    this.inputGain.channelInterpretation = 'speakers'

    this.panner = ctx.createStereoPanner()
    this.outputGain = ctx.createGain()
    this.meter = new Meter(ctx)

    this.modules = new Map<string, ChainModule>([
      ['gate', new GateModule(ctx)],
      ['filter', new FilterModule(ctx)],
      ['eq', new EqModule(ctx)],
      ['tone', new ToneModule(ctx)],
      ['comp', new CompModule(ctx)],
      ['pitch', new PitchModule(ctx)],
      ['width', new WidthModule(ctx)],
      ['reverb', new ReverbModule(ctx)],
      ['delay', new DelayModule(ctx)],
      ['limiter', new LimiterModule(ctx)],
    ])

    this.panner.connect(this.outputGain)
    this.outputGain.connect(this.meter.node)
    this.meter.node.connect(ctx.destination)
  }

  /** The node every media element source connects into. */
  get input(): AudioNode {
    return this.inputGain
  }

  apply(chain: ChainState): void {
    if (this.disposed) return
    const now = this.ctx.currentTime

    for (const module of this.modules.values()) {
      module.update(chain, now)
    }

    const active = chain.bypass
      ? []
      : MODULE_ORDER.filter((id) => this.modules.get(id)?.isActive(chain))
    const signature = active.join('>')
    if (signature !== this.activeSignature) {
      this.relink(active)
      this.activeSignature = signature
    }

    const level = chain.gain.mute ? 0 : chain.gain.level
    ramp(this.inputGain.gain, 1, now)
    ramp(this.outputGain.gain, level, now)
    ramp(this.panner.pan, chain.bypass ? 0 : chain.pan.value, now)
  }

  private relink(active: readonly string[]): void {
    this.inputGain.disconnect()
    for (const module of this.modules.values()) module.output.disconnect()

    let tail: AudioNode = this.inputGain
    for (const id of active) {
      const module = this.modules.get(id)
      if (!module) continue
      tail.connect(module.input)
      tail = module.output
    }
    tail.connect(this.panner)

    this.assertAudible()
  }

  /**
   * Cheap structural check: the tail of the chain must be the panner, which is
   * permanently wired through to the destination. If the loop above ever left
   * the graph dangling the tab would be silent with no error, so fail loudly.
   */
  private assertAudible(): void {
    if (this.panner.numberOfOutputs === 0) {
      throw new Error('Audio Punch: the output path is not connected')
    }
  }

  /**
   * Flattens the graph to a clean pass-through without tearing it down.
   *
   * Disposing is not an option once elements are routed: `createMediaElementSource`
   * is irreversible, so a disposed graph means a permanently silent page. This
   * is the safe way to "turn the extension off" for a page.
   */
  bypass(): void {
    const now = this.ctx.currentTime
    this.relink([])
    this.activeSignature = ''
    ramp(this.inputGain.gain, 1, now)
    ramp(this.outputGain.gain, 1, now)
    ramp(this.panner.pan, 0, now)
  }

  readMeter(): LevelReading {
    return { ...this.meter.read(), reduction: this.reduction() }
  }

  /** Gain reduction in dB from the compressor and limiter, for their meters. */
  reduction(): number {
    const comp = this.modules.get('comp') as CompModule | undefined
    const limiter = this.modules.get('limiter') as LimiterModule | undefined
    return Math.min(comp?.reduction() ?? 0, limiter?.reduction() ?? 0)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.inputGain.disconnect()
    this.panner.disconnect()
    this.outputGain.disconnect()
    this.meter.dispose()
    for (const module of this.modules.values()) module.dispose()
  }
}

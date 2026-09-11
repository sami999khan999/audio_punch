/**
 * The in-overlay keyboard map.
 *
 * The browser caps an extension at four shortcuts with suggested keys, so
 * those four (in `manifest.config.ts`) are reserved for things that must work
 * with nothing on screen. Everything else lives here and is handled while the
 * overlay has focus — which also means these bindings never fight the page's
 * own shortcuts, because the page does not have focus when they fire.
 */
import { MODULE_LABELS } from '../shared/params.ts'
import { MODULE_IDS, type ModuleId } from '../shared/types.ts'
import type { MixerActions } from '../ui/views/mixer.ts'

export interface ActionDef {
  id: string
  label: string
  group: string
}

/** Every bindable action, in the order the help sheet lists them. */
export const ACTION_CATALOG: ActionDef[] = [
  { id: 'overlay.close', label: 'Close the mixer', group: 'Panel' },
  { id: 'overlay.help', label: 'Show this list', group: 'Panel' },
  { id: 'overlay.dashboard', label: 'Open the full desk', group: 'Panel' },
  { id: 'chain.bypass', label: 'Bypass this strip', group: 'Panel' },
  { id: 'global.toggle', label: 'Global chain on / off', group: 'Panel' },

  { id: 'strip.next', label: 'Next strip', group: 'Strips' },
  { id: 'strip.prev', label: 'Previous strip', group: 'Strips' },
  { id: 'strip.global', label: 'Jump to global', group: 'Strips' },
  { id: 'strip.ignoreGlobal', label: 'Pin this site off global', group: 'Strips' },
  { id: 'strip.reset', label: 'Reset this strip', group: 'Strips' },

  { id: 'gain.up', label: 'Level up', group: 'Level' },
  { id: 'gain.down', label: 'Level down', group: 'Level' },
  { id: 'gain.fine.up', label: 'Level up, fine', group: 'Level' },
  { id: 'gain.fine.down', label: 'Level down, fine', group: 'Level' },
  { id: 'gain.mute', label: 'Mute this strip', group: 'Level' },

  { id: 'eq.bandNext', label: 'Next EQ band', group: 'Equaliser' },
  { id: 'eq.bandPrev', label: 'Previous EQ band', group: 'Equaliser' },
  { id: 'eq.boost', label: 'Boost the band', group: 'Equaliser' },
  { id: 'eq.cut', label: 'Cut the band', group: 'Equaliser' },
  { id: 'eq.flat', label: 'Flatten the EQ', group: 'Equaliser' },

  ...MODULE_IDS.filter((id) => id !== 'gain' && id !== 'pan').map((id) => ({
    id: `module.${id}`,
    label: `${MODULE_LABELS[id]} on / off`,
    group: 'Modules',
  })),

  { id: 'template.remove', label: 'Remove the applied template', group: 'Templates' },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `template.slot${i + 1}`,
    label: `Apply template ${i + 1}`,
    group: 'Templates',
  })),
]

interface Accelerator {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
}

export function parseAccelerator(text: string): Accelerator {
  const parts = text.split('+')
  const key = parts.pop() ?? ''
  const lower = parts.map((p) => p.toLowerCase())
  return {
    // Single characters are compared case-insensitively; named keys keep their
    // canonical spelling ('ArrowUp', 'Escape').
    key: key.length === 1 ? key.toLowerCase() : key,
    ctrl: lower.includes('ctrl') || lower.includes('cmd') || lower.includes('meta'),
    alt: lower.includes('alt') || lower.includes('option'),
    shift: lower.includes('shift'),
  }
}

export function formatAccelerator(text: string): string {
  const accel = parseAccelerator(text)
  const parts: string[] = []
  if (accel.ctrl) parts.push('Ctrl')
  if (accel.alt) parts.push('Alt')
  if (accel.shift) parts.push('Shift')
  const named: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Backspace: '⌫',
    Enter: '↵',
    ' ': 'Space',
  }
  parts.push(named[accel.key] ?? (accel.key.length === 1 ? accel.key.toUpperCase() : accel.key))
  return parts.join(' + ')
}

/** Turns a live key press into the accelerator string it would bind to. */
export function acceleratorFromEvent(event: KeyboardEvent): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  // A shifted character already encodes the shift in `key`, so only record the
  // modifier for named keys where it is the only thing distinguishing them.
  if (event.shiftKey && event.key.length > 1) parts.push('Shift')
  parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key)
  return parts.join('+')
}

function matches(event: KeyboardEvent, accel: Accelerator): boolean {
  if ((event.ctrlKey || event.metaKey) !== accel.ctrl) return false
  if (event.altKey !== accel.alt) return false
  if (accel.key.length === 1) {
    // The character itself carries the shift state, so checking shiftKey here
    // would break bindings like '?' that require it on most layouts.
    return event.key.toLowerCase() === accel.key
  }
  if (event.shiftKey !== accel.shift) return false
  return event.key === accel.key
}

export interface KeymapOptions {
  actions: MixerActions
  keymap: () => Record<string, string[]>
  onHelp: () => void
  onClose: () => void
}

/**
 * Returns a handler that runs the bound action and reports whether it consumed
 * the event, so the caller can stop it reaching the page.
 */
export function createKeymap(options: KeymapOptions): (event: KeyboardEvent) => boolean {
  const { actions } = options

  const handlers: Record<string, () => void> = {
    'overlay.close': options.onClose,
    'overlay.help': options.onHelp,
    'overlay.dashboard': actions.openDashboard,
    'chain.bypass': actions.toggleBypass,
    'global.toggle': actions.toggleGlobal,

    'strip.next': () => actions.selectRelative(1),
    'strip.prev': () => actions.selectRelative(-1),
    'strip.global': actions.selectGlobal,
    'strip.ignoreGlobal': actions.toggleIgnoreGlobal,
    'strip.reset': actions.resetTarget,

    'gain.up': () => actions.nudgeGain(1),
    'gain.down': () => actions.nudgeGain(-1),
    'gain.fine.up': () => actions.nudgeGain(0.2),
    'gain.fine.down': () => actions.nudgeGain(-0.2),
    'gain.mute': actions.toggleMute,

    'eq.bandNext': () => actions.moveEqBand(1),
    'eq.bandPrev': () => actions.moveEqBand(-1),
    'eq.boost': () => actions.nudgeEqBand(1),
    'eq.cut': () => actions.nudgeEqBand(-1),
    'eq.flat': actions.flattenEq,

    'template.remove': actions.removeTemplate,
  }

  for (const id of MODULE_IDS) {
    if (id === 'gain' || id === 'pan') continue
    handlers[`module.${id}`] = () => actions.toggleModule(id as ModuleId)
  }
  for (let slot = 1; slot <= 9; slot++) {
    handlers[`template.slot${slot}`] = () => actions.applyTemplateSlot(slot - 1)
  }

  return (event: KeyboardEvent): boolean => {
    const bindings = options.keymap()
    for (const [actionId, accelerators] of Object.entries(bindings)) {
      const handler = handlers[actionId]
      if (!handler) continue
      for (const accelerator of accelerators) {
        if (matches(event, parseAccelerator(accelerator))) {
          handler()
          return true
        }
      }
    }
    return false
  }
}

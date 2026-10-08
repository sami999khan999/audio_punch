/**
 * Shortcut strings: parsing, comparing, recording and displaying them.
 *
 * Two spellings meet here. The browser's, from chrome.commands.getAll(), which
 * uses display names ("Alt+Shift+Up Arrow", "Ctrl+M"), and the one the popup
 * records, which ends in a KeyboardEvent.code ("Alt+Shift+KeyK"). Both parse
 * to the same thing, so either can be compared with the other.
 */
import type { CommandName } from './messages.ts'

export const COMMANDS: CommandName[] = [
  'volume-up',
  'volume-down',
  'toggle-mute',
  'reset',
  'toggle-global',
]

/**
 * The keys every command starts with.
 *
 * Owned by the extension rather than left to the manifest: Chrome applies a
 * manifest's suggested keys only on a fresh install, only for four commands,
 * and silently drops any that clash with another extension — so relying on it
 * leaves commands with no key at all. These are what the popup shows and the
 * page listens for until the user sets something else.
 */
export const DEFAULT_BINDINGS: Record<CommandName, string> = {
  'volume-up': 'Alt+Shift+ArrowUp',
  'volume-down': 'Alt+Shift+ArrowDown',
  'toggle-mute': 'Alt+Shift+KeyM',
  reset: 'Alt+Shift+KeyR',
  'toggle-global': 'Alt+Shift+KeyG',
}

/**
 * Chrome's key names mapped to KeyboardEvent.code.
 *
 * Matching on `code` rather than `key` sidesteps keyboard layouts and the way
 * modifiers rewrite the character. Spaces are stripped before the lookup
 * because a manifest "Up" comes back from getAll() as "Up Arrow".
 */
function codeFor(name: string): string {
  const compact = name.replace(/\s+/g, '')
  const named: Record<string, string> = {
    Up: 'ArrowUp',
    UpArrow: 'ArrowUp',
    Down: 'ArrowDown',
    DownArrow: 'ArrowDown',
    Left: 'ArrowLeft',
    LeftArrow: 'ArrowLeft',
    Right: 'ArrowRight',
    RightArrow: 'ArrowRight',
    Comma: 'Comma',
    Period: 'Period',
  }
  if (named[compact]) return named[compact]
  if (/^[A-Za-z]$/.test(compact)) return `Key${compact.toUpperCase()}`
  if (/^[0-9]$/.test(compact)) return `Digit${compact}`
  return compact
}

export interface ParsedShortcut {
  code: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export function parseShortcut(shortcut: string): ParsedShortcut | null {
  const parts = shortcut.split('+').map((p) => p.trim())
  const key = parts.pop()
  if (!key) return null
  const lower = parts.map((p) => p.toLowerCase())
  return {
    code: codeFor(key),
    ctrl: lower.includes('ctrl') || lower.includes('macctrl'),
    alt: lower.includes('alt') || lower.includes('option'),
    shift: lower.includes('shift'),
    meta: lower.includes('command') || lower.includes('meta'),
  }
}

/** Whether two shortcuts are the same keys, whatever their spelling. */
export function sameShortcut(a: string, b: string): boolean {
  const x = parseShortcut(a)
  const y = parseShortcut(b)
  if (!x || !y) return false
  return (
    x.code === y.code && x.ctrl === y.ctrl && x.alt === y.alt && x.shift === y.shift && x.meta === y.meta
  )
}

export function matchesEvent(event: KeyboardEvent, shortcut: ParsedShortcut): boolean {
  return (
    event.code === shortcut.code &&
    event.altKey === shortcut.alt &&
    event.shiftKey === shortcut.shift &&
    event.metaKey === shortcut.meta &&
    event.ctrlKey === shortcut.ctrl
  )
}

const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight',
])

/**
 * The shortcut a keypress spells, or null while only modifiers are held — the
 * recorder waits for the key that completes the combination.
 */
export function shortcutFromEvent(event: KeyboardEvent): string | null {
  if (!event.code || MODIFIER_CODES.has(event.code)) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Command')
  parts.push(event.code)
  return parts.join('+')
}

/** A shortcut with no Ctrl, Alt or Command would fire while typing text. */
export function needsTypingGuard(shortcut: ParsedShortcut): boolean {
  return !shortcut.ctrl && !shortcut.alt && !shortcut.meta
}

/** For display: "Alt+Shift+KeyK" -> "Alt+Shift+K", "Up Arrow" -> "↑". */
export function prettyShortcut(shortcut: string): string {
  const parsed = parseShortcut(shortcut)
  if (!parsed) return shortcut
  const glyphs: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
  }
  const key =
    glyphs[parsed.code] ??
    parsed.code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ')
  const parts: string[] = []
  if (parsed.ctrl) parts.push('Ctrl')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')
  if (parsed.meta) parts.push('Cmd')
  parts.push(key)
  return parts.join('+')
}

/**
 * Content script: the audio engine for this page.
 *
 * Every `<audio>` and `<video>` is routed through one gain node, which is what
 * allows volumes above 100% — the element's own `volume` property caps at 1.
 *
 * Two rules this file exists to respect:
 *
 * 1. `createMediaElementSource` may be called **once** per element, ever.
 *    Calling it twice throws, hence the WeakMap.
 * 2. Once an element is routed, its audio no longer reaches the speakers by
 *    itself. If the gain node is not connected through to the destination, the
 *    page goes silent — a far worse failure than a volume not applying.
 */
import type { Binding, CommandName, ContentCommand, ContentReport } from '../shared/messages.ts'
import type { AudioState } from '../shared/types.ts'
import { formatVolume } from '../shared/defaults.ts'

/** Sites mutate constantly; rescanning on every mutation is what makes an
 *  extension show up in a page's performance trace. */
const SCAN_DEBOUNCE_MS = 250

/** How long the on-screen value stays up after a shortcut. */
const ANNOUNCE_MS = 1100

/**
 * Chrome's key names as they appear in a shortcut string, mapped to
 * KeyboardEvent.code.
 *
 * Two details worth keeping. Matching on `code` rather than `key` sidesteps
 * keyboard layouts and the way modifiers rewrite the character. And the names
 * are the browser's *display* spellings, which are not what the manifest asked
 * for: a manifest "Up" comes back from chrome.commands.getAll() as
 * "Up Arrow". Spaces are stripped before the lookup for that reason.
 */
function codeFor(name: string): string {
  const compact = name.replace(/\s+/g, '')
  const named: Record<string, string> = {
    Up: 'ArrowUp',
    UpArrow: 'ArrowUp',
    ArrowUp: 'ArrowUp',
    Down: 'ArrowDown',
    DownArrow: 'ArrowDown',
    ArrowDown: 'ArrowDown',
    Left: 'ArrowLeft',
    LeftArrow: 'ArrowLeft',
    ArrowLeft: 'ArrowLeft',
    Right: 'ArrowRight',
    RightArrow: 'ArrowRight',
    ArrowRight: 'ArrowRight',
    Space: 'Space',
    Comma: 'Comma',
    Period: 'Period',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
    Delete: 'Delete',
  }
  if (named[compact]) return named[compact]
  if (/^[A-Za-z]$/.test(compact)) return `Key${compact.toUpperCase()}`
  if (/^[0-9]$/.test(compact)) return `Digit${compact}`
  return compact
}

interface ParsedBinding {
  command: CommandName
  code: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

function parseBinding({ command, shortcut }: Binding): ParsedBinding | null {
  const parts = shortcut.split('+').map((p) => p.trim())
  const key = parts.pop()
  if (!key) return null
  const lower = parts.map((p) => p.toLowerCase())
  return {
    command,
    code: codeFor(key),
    ctrl: lower.includes('ctrl'),
    alt: lower.includes('alt'),
    shift: lower.includes('shift'),
    meta: lower.includes('command') || lower.includes('meta'),
  }
}

function matches(event: KeyboardEvent, binding: ParsedBinding): boolean {
  return (
    event.code === binding.code &&
    event.altKey === binding.alt &&
    event.shiftKey === binding.shift &&
    event.metaKey === binding.meta &&
    event.ctrlKey === binding.ctrl
  )
}

// Frames would each build their own graph; only the top document does.
if (window.top === window.self) {
  start()
}

function start(): void {
  // Declared before anything that could read them: the observer and the
  // message listener both call in, and a `let` declared lower would be in its
  // temporal dead zone at that moment.
  let ctx: AudioContext | null = null
  let gain: GainNode | null = null
  let audio: AudioState = { volume: 1, muted: false }
  let debounce: ReturnType<typeof setTimeout> | null = null
  let cached: HTMLMediaElement[] = []
  let parsed: ParsedBinding[] = []
  let toast: HTMLElement | null = null
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  const routed = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()
  const refused = new WeakSet<HTMLMediaElement>()

  /** The context is created on the first media element, never before: a page
   *  that plays nothing should not pay for one. */
  function ensureGain(): GainNode | null {
    if (!gain) {
      try {
        ctx = new AudioContext()
        gain = ctx.createGain()
        gain.connect(ctx.destination)
        applyGain()
      } catch {
        return null
      }
    }
    return gain
  }

  function applyGain(): void {
    if (!gain || !ctx) return
    const target = audio.muted ? 0 : audio.volume
    // A short ramp rather than a jump: stepping a gain node clicks.
    gain.gain.setTargetAtTime(target, ctx.currentTime, 0.015)
  }

  function hook(element: HTMLMediaElement): void {
    if (routed.has(element) || refused.has(element)) return
    const node = ensureGain()
    if (!node || !ctx) return

    let source: MediaElementAudioSourceNode
    try {
      source = ctx.createMediaElementSource(element)
    } catch {
      // Already routed by another script, or the browser refuses. Leaving it on
      // the normal playback path is correct — the audio still plays, it just is
      // not boosted. Remembered so the next scan does not try again.
      refused.add(element)
      return
    }
    routed.set(element, source)
    source.connect(node)

    // The context starts suspended until a gesture; playing counts as one.
    element.addEventListener('play', resume, { passive: true })
    if (!element.paused) resume()
  }

  function resume(): void {
    if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined)
  }

  function scan(): void {
    cached = Array.from(document.querySelectorAll<HTMLMediaElement>('audio, video'))
    for (const element of cached) hook(element)
  }

  function scheduleScan(): void {
    if (debounce) return
    debounce = setTimeout(() => {
      debounce = null
      scan()
    }, SCAN_DEBOUNCE_MS)
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
  // An element can start playing without ever being added to the DOM anew.
  document.addEventListener(
    'play',
    (event) => {
      if (event.target instanceof HTMLMediaElement) hook(event.target)
    },
    true,
  )

  /**
   * Shows the value on screen.
   *
   * Appended to the fullscreen element when there is one: a fullscreen element
   * is promoted to the browser's top layer, where nothing outside it renders at
   * all — no z-index reaches past it.
   */
  function announce(global: boolean): void {
    const host = document.fullscreenElement ?? document.body
    if (!host) return

    if (!toast) {
      toast = document.createElement('div')
      toast.style.cssText = [
        'all: initial',
        'position: fixed',
        'left: 50%',
        'top: 8%',
        'transform: translateX(-50%)',
        'z-index: 2147483647',
        'padding: 14px 22px',
        'border-radius: 14px',
        'background: rgba(10, 14, 18, 0.82)',
        'backdrop-filter: blur(12px)',
        '-webkit-backdrop-filter: blur(12px)',
        'color: #fff',
        'font: 600 26px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        'font-variant-numeric: tabular-nums',
        'letter-spacing: -0.01em',
        'text-align: center',
        'pointer-events: none',
        'transition: opacity 180ms ease',
      ].join(';')
    }
    if (toast.parentElement !== host) host.append(toast)

    const label = audio.muted ? 'Muted' : formatVolume(audio.volume)
    toast.textContent = global ? `${label}  ·  all sites` : label
    toast.style.opacity = '1'

    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      if (toast) toast.style.opacity = '0'
      toastTimer = setTimeout(() => toast?.remove(), 220)
    }, ANNOUNCE_MS)
  }

  /**
   * The fullscreen fallback.
   *
   * The browser restricts keyboard input while a page is fullscreen, so
   * chrome.commands stops firing — and the toolbar is hidden, so the popup is
   * unreachable too. The page still receives key events, so it forwards them.
   *
   * Scoped to fullscreen deliberately: outside it chrome.commands works, and
   * handling the keys here as well would apply every press twice.
   */
  window.addEventListener(
    'keydown',
    (event) => {
      if (!document.fullscreenElement || event.repeat) return
      const binding = parsed.find((b) => matches(event, b))
      if (!binding) return
      event.preventDefault()
      event.stopPropagation()
      void chrome.runtime
        .sendMessage({ type: 'content:command', command: binding.command } satisfies ContentReport)
        .catch(() => undefined)
    },
    true,
  )

  chrome.runtime.onMessage.addListener((message: ContentCommand, _sender, sendResponse) => {
    if (message?.type === 'content:apply' && message.audio) {
      audio = message.audio
      applyGain()
      // Newly arrived elements are picked up the moment a value is pushed.
      scan()
      if (message.announce) announce(message.global === true)
    }
    if (message?.type === 'content:bindings') {
      parsed = message.bindings
        .map(parseBinding)
        .filter((b): b is ParsedBinding => b !== null)
    }
    sendResponse({
      ok: true,
      media: cached.length,
      audio,
      routed: gain !== null,
      bindings: parsed.length,
    })
    return false
  })

  scan()

  // Announce, and take back whatever this origin is set to.
  void chrome.runtime
    .sendMessage({ type: 'content:ready', hasMedia: cached.length > 0 } satisfies ContentReport)
    .catch(() => undefined)
}

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
import { defaultAudio, formatVolume } from '../shared/defaults.ts'
import { nudge, pushIsCurrent } from '../background/resolve.ts'

/** Sites mutate constantly; rescanning on every mutation is what makes an
 *  extension show up in a page's performance trace. */
const SCAN_DEBOUNCE_MS = 250

/** How long the on-screen value stays up after a shortcut. */
const ANNOUNCE_MS = 1100

/** How often the expensive shadow-root walk may run. */
const DEEP_SCAN_INTERVAL_MS = 2000

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

/**
 * Runs in every frame, not just the top document.
 *
 * Plenty of sites put their player in an iframe — embeds, and anything built on
 * a third-party player. A top-frame-only script simply never sees those, which
 * is why this worked on YouTube (a top-level <video>) and not elsewhere.
 */
start()

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
  let deepDue = 0
  /** Elements found behind a shadow root, kept between deep walks. */
  let shadowed: HTMLMediaElement[] = []
  /** Elements whose volume/mute we have written, so we only undo our own. */
  const ourVolume = new WeakSet<HTMLMediaElement>()
  const ourMute = new WeakSet<HTMLMediaElement>()
  let lastCapped: boolean | null = null
  /** What the last push said about the global switch, for the announcement. */
  let globalOn = false
  /** Counts presses this page has applied itself, so a push that answers an
   *  earlier one can be recognised and dropped. */
  let localSeq = 0
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

  /**
   * Whether routing this element through Web Audio is safe.
   *
   * `createMediaElementSource` on media the page fetched cross-origin without
   * CORS headers does not throw — it yields **silence**, permanently, because
   * routing cannot be undone. That is far worse than the volume simply not
   * applying, so anything not demonstrably same-origin is driven through the
   * element's own volume instead.
   *
   * A blob: or data: source is same-origin by construction, which is what
   * media-source players (YouTube among them) produce.
   */
  function safeToRoute(element: HTMLMediaElement): boolean {
    const src = element.currentSrc || element.src
    if (!src) return false
    if (src.startsWith('blob:') || src.startsWith('data:')) return true
    if (element.crossOrigin !== null) return true
    try {
      return new URL(src, location.href).origin === location.origin
    } catch {
      return false
    }
  }

  /** Routes an element if that is safe, otherwise leaves it to direct control. */
  function adopt(element: HTMLMediaElement): void {
    if (routed.has(element) || refused.has(element)) return
    if (safeToRoute(element)) hook(element)
    // A source can arrive after the element does, so re-decide when it loads.
    element.addEventListener('loadeddata', () => adopt(element), { passive: true })
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
    // The gain node owns the level now; the element's own must be out of the way.
    element.volume = 1
    element.muted = false

    // The context starts suspended until a gesture; playing counts as one.
    element.addEventListener('play', resume, { passive: true })
    if (!element.paused) resume()
  }

  /**
   * Drives elements that are not routed.
   *
   * Their volume cannot exceed 100% — that is the element property's ceiling,
   * and the whole reason routing exists — so boost is capped rather than
   * silently ignored. The page is not fought over it: if the site's own control
   * changes the volume afterwards, the site wins.
   */
  function applyToElements(): void {
    for (const element of cached) {
      if (routed.has(element)) continue
      const level = Math.min(1, audio.volume)

      // Only write when we are actually changing something, and only undo what
      // we set. A site that muted its own player should stay muted when our
      // state is simply "not muted".
      if (level !== 1) {
        element.volume = level
        ourVolume.add(element)
      } else if (ourVolume.has(element)) {
        element.volume = 1
        ourVolume.delete(element)
      }

      if (audio.muted) {
        element.muted = true
        ourMute.add(element)
      } else if (ourMute.has(element)) {
        element.muted = false
        ourMute.delete(element)
      }
    }
    reportCapped()
  }

  /**
   * Boost above 100% needs the gain node, and an element we dare not route
   * cannot have it. Tell the worker, so the popup can say so rather than
   * leaving the user to wonder why 300% sounds like 100%.
   */
  function reportCapped(): void {
    const capped = cached.length > 0 && cached.some((el) => !routed.has(el))
    if (capped === lastCapped) return
    lastCapped = capped
    void chrome.runtime
      .sendMessage({ type: 'content:ready', hasMedia: cached.length > 0, capped } satisfies ContentReport)
      .catch(() => undefined)
  }

  function resume(): void {
    if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined)
  }

  /**
   * Finds media elements, including inside open shadow roots.
   *
   * The plain query is answered from the browser's selector index and runs
   * every time. The shadow walk visits every element on the page and is far
   * more expensive, so it is rate-limited rather than skipped — an earlier
   * version only walked when the plain query found nothing, which meant a page
   * with one ordinary video and one inside a custom element never had the
   * second one found.
   */
  function collect(deep: boolean): HTMLMediaElement[] {
    const found = Array.from(document.querySelectorAll<HTMLMediaElement>('audio, video'))

    const now = Date.now()
    if (deep && now >= deepDue) {
      deepDue = now + DEEP_SCAN_INTERVAL_MS
      const walk = (root: ParentNode): void => {
        for (const node of root.querySelectorAll<HTMLElement>('*')) {
          if (node instanceof HTMLMediaElement) {
            if (!found.includes(node)) found.push(node)
          } else if (node.shadowRoot) {
            walk(node.shadowRoot)
          }
        }
      }
      walk(document)
      shadowed = found.filter((el) => el.getRootNode() !== document)
    } else {
      // Between walks, keep the ones already discovered behind a shadow root.
      for (const el of shadowed) {
        if (el.isConnected && !found.includes(el)) found.push(el)
      }
    }
    return found
  }

  /**
   * `deep` walks open shadow roots as well, which costs a pass over every
   * element on the page. Applying a value asks for the cheap scan only: the
   * whole point is that a keypress is heard at once, and the debounced scan
   * below is already walking for anything new.
   */
  function scan(deep = true): void {
    cached = collect(deep)
    for (const element of cached) adopt(element)
    applyToElements()
  }

  function scheduleScan(): void {
    if (debounce) return
    debounce = setTimeout(() => {
      debounce = null
      scan()
    }, SCAN_DEBOUNCE_MS)
  }

  new MutationObserver((records) => {
    // A page that rewrites a timestamp every frame should not cost a scan.
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof Element) return scheduleScan()
      for (const node of record.removedNodes) if (node instanceof Element) return scheduleScan()
    }
  }).observe(document.documentElement, { childList: true, subtree: true })
  // An element can start playing without ever being added to the DOM anew.
  document.addEventListener(
    'play',
    (event) => {
      if (event.target instanceof HTMLMediaElement) hook(event.target)
    },
    true,
  )

  /**
   * Which frame speaks for the tab.
   *
   * With the script in every frame, a naive check would have the top document
   * and the player's iframe both announce and both forward the same keypress.
   * When an iframe is fullscreen the *top* document's fullscreenElement is the
   * <iframe> itself, so "has a fullscreen element that is not an iframe" picks
   * out exactly one frame; otherwise the top frame speaks.
   */
  function announcingFrame(): boolean {
    const fs = document.fullscreenElement
    if (fs) return !(fs instanceof HTMLIFrameElement)
    return window.top === window.self
  }

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
  /**
   * Moves this page's audio at once, without waiting for the worker.
   *
   * The worker is stopped whenever it is idle, so the round trip behind a
   * shortcut can take as long as starting it up — which is what made presses
   * feel like they did nothing and then all landed together. The step is
   * computed with the very function the worker uses, against the value the
   * worker last pushed, so the authoritative push that follows is the same
   * number and lands silently.
   *
   * `toggle-global` is not done here: swapping scope means playing the *other*
   * scope's value, and only the worker knows what that is.
   */
  function stepLocally(command: CommandName): void {
    switch (command) {
      case 'volume-up':
        audio = nudge(audio, 1)
        break
      case 'volume-down':
        audio = nudge(audio, -1)
        break
      case 'toggle-mute':
        audio = { volume: audio.volume, muted: !audio.muted }
        break
      case 'reset':
        audio = defaultAudio()
        break
      default:
        return
    }
    localSeq += 1
    applyGain()
    applyToElements()
    if (announcingFrame()) announce(globalOn)
  }

  window.addEventListener(
    'keydown',
    (event) => {
      if (!document.fullscreenElement || event.repeat) return
      // Only the frame holding the fullscreen content forwards, or an iframe
      // player would have every press counted twice.
      if (document.fullscreenElement instanceof HTMLIFrameElement) return
      const binding = parsed.find((b) => matches(event, b))
      if (!binding) return
      event.preventDefault()
      event.stopPropagation()
      stepLocally(binding.command)
      void chrome.runtime
        .sendMessage({
          type: 'content:command',
          command: binding.command,
          seq: localSeq,
        } satisfies ContentReport)
        .catch(() => undefined)
    },
    true,
  )

  chrome.runtime.onMessage.addListener((message: ContentCommand, _sender, sendResponse) => {
    if (message?.type === 'content:apply' && message.audio) {
      globalOn = message.global === true
      // A push answering a press this page has already moved past. Its value
      // is older than what is playing, and the next push carries the settled
      // one, so this is dropped rather than played.
      if (!pushIsCurrent(message.seq, localSeq)) {
        sendResponse({
          ok: true,
          media: cached.length,
          audio,
          routed: gain !== null,
          bindings: parsed.length,
        })
        return false
      }
      audio = message.audio
      applyGain()
      // Newly arrived elements are picked up the moment a value is pushed, but
      // with the cheap scan only — this runs on the page's main thread, and a
      // shadow-root walk here would delay the very thing it is meant to serve.
      scan(false)
      if (message.announce && announcingFrame()) announce(globalOn)
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
      /** How many presses this page acted on itself, without waiting for the
       *  worker. The end-to-end test asserts on it. */
      localSteps: localSeq,
    })
    return false
  })

  scan()

  // Announce, and take back whatever this origin is set to.
  void chrome.runtime
    .sendMessage({
      type: 'content:ready',
      hasMedia: cached.length > 0,
      capped: cached.some((el) => !routed.has(el)),
    } satisfies ContentReport)
    .catch(() => undefined)
}

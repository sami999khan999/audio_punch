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
import type { ContentCommand, ContentReport } from '../shared/messages.ts'
import type { AudioState } from '../shared/types.ts'

/** Sites mutate constantly; rescanning on every mutation is what makes an
 *  extension show up in a page's performance trace. */
const SCAN_DEBOUNCE_MS = 250

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

  chrome.runtime.onMessage.addListener((message: ContentCommand, _sender, sendResponse) => {
    if (message?.type === 'content:apply' && message.audio) {
      audio = message.audio
      applyGain()
      // Newly arrived elements are picked up the moment a value is pushed.
      scan()
    }
    sendResponse({ ok: true, media: cached.length, audio, routed: gain !== null })
    return false
  })

  scan()

  // Announce, and take back whatever this origin is set to.
  void chrome.runtime
    .sendMessage({ type: 'content:ready', hasMedia: cached.length > 0 } satisfies ContentReport)
    .catch(() => undefined)
}

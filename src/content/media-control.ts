/**
 * Finds the page's media elements, routes them through the engine, and applies
 * playback speed.
 *
 * Speed is the one control the audio graph cannot deliver: it belongs to the
 * media element, not the signal path. Everything else this module does is
 * about noticing elements — sites add players lazily, swap them on navigation,
 * and bury them in shadow roots.
 */
import type { ContentEngine } from './engine.ts'

export interface MediaController {
  setRate(rate: number): void
  count(): number
  hasMedia(): boolean
  /** Find and hook media elements. Call once after construction, then any time
   *  the page may have gained a player. */
  scan(): void
  destroy(): void
}

/** Debounce for the DOM observer. Sites mutate constantly; scanning on every
 *  mutation is what makes an extension show up in a page's performance trace. */
const SCAN_DEBOUNCE_MS = 250

/**
 * Collects media elements, including those inside open shadow roots — plenty of
 * sites wrap their player in a custom element.
 *
 * The light pass is a plain `audio, video` query, which the browser answers
 * from its selector index. The deep pass walks every element looking for shadow
 * roots and is far more expensive, so it is kept off the hot path: the cached
 * result is refreshed on a debounced schedule, never per mutation and never per
 * meter frame.
 */
function collectLight(): HTMLMediaElement[] {
  return Array.from(document.querySelectorAll<HTMLMediaElement>('audio, video'))
}

function collectDeep(root: ParentNode, found: HTMLMediaElement[] = []): HTMLMediaElement[] {
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (el instanceof HTMLMediaElement) found.push(el)
    else if (el.shadowRoot) collectDeep(el.shadowRoot, found)
  }
  return found
}

export function createMediaController(
  engine: ContentEngine,
  onChange: (hasMedia: boolean, count: number) => void,
): MediaController {
  let rate = 1
  let lastSignature = ''
  /** Last known media elements. Every read goes through this, never the DOM. */
  let cached: HTMLMediaElement[] = []
  let deepDue = 0
  let debounce: ReturnType<typeof setTimeout> | null = null

  function elements(): HTMLMediaElement[] {
    const light = collectLight()
    // A deep walk only when the cheap query found nothing new and enough time
    // has passed — that is the only case where a shadow-root player could be
    // hiding from us.
    const now = Date.now()
    if (now >= deepDue) {
      deepDue = now + 2000
      const deep = collectDeep(document)
      if (deep.length > light.length) return deep
    }
    return light
  }

  function applyRate(list = cached): void {
    for (const element of list) {
      // Writing an identical rate still fires ratechange on some sites and can
      // fight their own player logic, so only write real changes.
      if (element.playbackRate !== rate) element.playbackRate = rate
    }
  }

  function scan(): void {
    const found = elements()
    cached = found
    for (const element of found) void engine.hook(element)
    if (rate !== 1) applyRate(found)

    const signature = `${found.length}`
    if (signature !== lastSignature) {
      lastSignature = signature
      onChange(found.length > 0, found.length)
    }
  }

  function scheduleScan(): void {
    if (debounce) return
    debounce = setTimeout(() => {
      debounce = null
      scan()
    }, SCAN_DEBOUNCE_MS)
  }

  const observer = new MutationObserver(scheduleScan)
  observer.observe(document.documentElement, { childList: true, subtree: true })

  // Players routinely reset playbackRate when a new source loads, and an
  // element can start playing without ever being added to the DOM anew.
  const onPlay = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLMediaElement)) return
    void engine.hook(target)
    if (rate !== 1 && target.playbackRate !== rate) target.playbackRate = rate
  }
  document.addEventListener('play', onPlay, true)
  document.addEventListener('loadeddata', onPlay, true)

  // Deliberately no initial scan here. Scanning calls back into `onChange`,
  // and the caller's own `const media = createMediaController(...)` has not
  // been assigned yet at this point — the callback would read it in its
  // temporal dead zone. The caller runs the first scan once it is wired up.

  return {
    setRate(next) {
      rate = next
      applyRate()
    },
    count: () => cached.length,
    hasMedia: () => cached.length > 0,
    scan,
    destroy() {
      observer.disconnect()
      if (debounce) clearTimeout(debounce)
      document.removeEventListener('play', onPlay, true)
      document.removeEventListener('loadeddata', onPlay, true)
      rate = 1
      applyRate()
    },
  }
}

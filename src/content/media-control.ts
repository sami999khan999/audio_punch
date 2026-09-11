/**
 * Playback speed, and telling the service worker whether this page has any
 * media elements at all.
 *
 * Speed is the one control the audio graph cannot deliver: under tab capture
 * the engine receives an already-rendered stream, so changing the rate has to
 * happen on the page's own <audio>/<video> elements. That also means speed is
 * unavailable on sites that generate audio entirely through Web Audio, which
 * is why the rack disables the control when this module reports no elements.
 */

type MediaElement = HTMLMediaElement

export interface MediaController {
  setRate(rate: number): void
  hasMedia(): boolean
  count(): number
  destroy(): void
}

export function createMediaController(onChange: (hasMedia: boolean, count: number) => void): MediaController {
  let rate = 1
  let lastReport = ''

  function elements(): MediaElement[] {
    return Array.from(document.querySelectorAll<MediaElement>('audio, video'))
  }

  function applyRate(): void {
    for (const element of elements()) {
      // Assigning an identical rate still fires ratechange on some sites and
      // can fight their own player logic, so only write real changes.
      if (element.playbackRate !== rate) element.playbackRate = rate
    }
  }

  function report(): void {
    const found = elements()
    const signature = `${found.length > 0}:${found.length}`
    if (signature === lastReport) return
    lastReport = signature
    onChange(found.length > 0, found.length)
  }

  // Sites add players lazily and swap them on navigation, so watch the tree
  // rather than probing once at startup.
  const observer = new MutationObserver(() => {
    report()
    if (rate !== 1) applyRate()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  // Players routinely reset playbackRate when a new source loads.
  const onPlay = (event: Event) => {
    const target = event.target
    if (rate !== 1 && target instanceof HTMLMediaElement && target.playbackRate !== rate) {
      target.playbackRate = rate
    }
  }
  document.addEventListener('play', onPlay, true)
  document.addEventListener('loadeddata', onPlay, true)

  report()

  return {
    setRate(next) {
      rate = next
      applyRate()
    },
    hasMedia: () => elements().length > 0,
    count: () => elements().length,
    destroy() {
      observer.disconnect()
      document.removeEventListener('play', onPlay, true)
      document.removeEventListener('loadeddata', onPlay, true)
      rate = 1
      applyRate()
    },
  }
}

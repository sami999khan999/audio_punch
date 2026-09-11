/**
 * Site identity. Settings are keyed by origin (scheme + host + port), so all
 * youtube.com tabs share a chain while music.youtube.com keeps its own.
 */

/** Pages the content script cannot be injected into, so the overlay can't open. */
const UNSUPPORTED_SCHEMES = [
  'chrome:',
  'chrome-extension:',
  'moz-extension:',
  'edge:',
  'about:',
  'devtools:',
  'view-source:',
  'file:',
  'data:',
]

const UNSUPPORTED_HOSTS = ['chromewebstore.google.com', 'chrome.google.com', 'addons.mozilla.org']

/**
 * Origins whose audio is normally DRM-protected. Capturing these produces
 * silence rather than an error, so the UI warns before arming instead of
 * letting the user think the extension is broken.
 */
const DRM_HOSTS = [
  'netflix.com',
  'open.spotify.com',
  'disneyplus.com',
  'hulu.com',
  'primevideo.com',
  'max.com',
  'hbomax.com',
  'peacocktv.com',
  'paramountplus.com',
  'music.amazon.com',
  'tidal.com',
  'play.google.com',
  'apple.com',
]

/** Normalises a tab URL to its origin, or '' when there isn't a usable one. */
export function originOf(url: string | undefined): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.origin
  } catch {
    return ''
  }
}

/** A short, human-readable name for an origin, for strip labels. */
export function prettyOrigin(origin: string): string {
  if (!origin) return 'Unknown'
  try {
    const host = new URL(origin).host
    return host.replace(/^www\./, '')
  } catch {
    return origin
  }
}

export function isSupportedPage(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (UNSUPPORTED_SCHEMES.includes(parsed.protocol)) return false
    if (UNSUPPORTED_HOSTS.includes(parsed.host)) return false
    if (parsed.pathname.endsWith('.pdf')) return false
    return true
  } catch {
    return false
  }
}

export function isDrmOrigin(origin: string): boolean {
  if (!origin) return false
  let host: string
  try {
    host = new URL(origin).host.replace(/^www\./, '')
  } catch {
    return false
  }
  return DRM_HOSTS.some((drm) => host === drm || host.endsWith(`.${drm}`))
}

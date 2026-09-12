/**
 * Site identity. Volume is remembered per origin (scheme + host + port), so all
 * youtube.com tabs share a setting while music.youtube.com keeps its own.
 */

/** Pages no content script can run in, so nothing can be adjusted there. */
const UNSUPPORTED_HOSTS = [
  'chromewebstore.google.com',
  'chrome.google.com',
  'addons.mozilla.org',
]

export function originOf(url: string | undefined): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    if (UNSUPPORTED_HOSTS.includes(parsed.host)) return ''
    if (parsed.pathname.endsWith('.pdf')) return ''
    return parsed.origin
  } catch {
    return ''
  }
}

/** A short, readable name for an origin. */
export function prettyOrigin(origin: string): string {
  if (!origin) return 'This page'
  try {
    return new URL(origin).host.replace(/^www\./, '')
  } catch {
    return origin
  }
}

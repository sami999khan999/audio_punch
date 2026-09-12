/**
 * Single source of truth for the extension manifest.
 *
 * Kept as TypeScript so the Chrome/Edge and Firefox manifests come from one
 * object.
 */

export type Target = 'chrome' | 'firefox'

const VERSION = '1.0.0'

/**
 * The browser allows an extension **four** shortcuts carrying a suggested key,
 * and declaring a fifth is not a soft failure: Chrome rejects the manifest and
 * the extension does not load at all.
 *
 * `reset` is therefore declared without one. It is a real command — it appears
 * at chrome://extensions/shortcuts for the user to assign, and once assigned it
 * works everywhere the others do, fullscreen included, because the in-page
 * fallback reads the live bindings rather than these defaults.
 */
const COMMANDS = {
  'volume-up': {
    suggested_key: { default: 'Alt+Shift+Up' },
    description: 'Volume up',
  },
  'volume-down': {
    suggested_key: { default: 'Alt+Shift+Down' },
    description: 'Volume down',
  },
  'toggle-mute': {
    suggested_key: { default: 'Alt+Shift+M' },
    description: 'Mute / unmute',
  },
  'toggle-global': {
    suggested_key: { default: 'Alt+Shift+G' },
    description: 'Switch between this site and all sites',
  },
  reset: {
    description: 'Reset to 100%',
  },
}

export function makeManifest(target: Target): Record<string, unknown> {
  const base = {
    manifest_version: 3,
    name: 'Audio Punch',
    version: VERSION,
    description: 'Volume control for any tab, including boost above 100%.',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'Audio Punch',
      default_popup: 'popup.html',
      default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' },
    },
    content_scripts: [
      {
        matches: ['http://*/*', 'https://*/*'],
        js: ['content.js'],
        run_at: 'document_idle',
        // Players are routinely inside an iframe; a top-frame-only script
        // never sees them.
        all_frames: true,
        match_about_blank: true,
      },
    ],
    commands: COMMANDS,
    permissions: ['storage', 'tabs'],
    host_permissions: ['<all_urls>'],
  }

  if (target === 'firefox') {
    return {
      ...base,
      background: { scripts: ['background.js'], type: 'module' },
      browser_specific_settings: {
        gecko: { id: 'audio-punch@local', strict_min_version: '115.0' },
      },
    }
  }

  return {
    ...base,
    background: { service_worker: 'background.js', type: 'module' },
    minimum_chrome_version: '116',
  }
}

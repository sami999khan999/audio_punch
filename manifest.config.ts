/**
 * Single source of truth for the extension manifest.
 *
 * Kept as TypeScript (rather than a static manifest.json) so that the Chrome /
 * Edge manifest and a future Firefox manifest are generated from one object.
 * `src/platform/` is the matching runtime split.
 */

export type Target = 'chrome' | 'firefox'

const VERSION = '0.1.0'

/**
 * Chrome allows at most four commands carrying a *suggested* key binding.
 * These four are the ones that must work with no UI on screen; every other
 * shortcut is handled by the in-overlay keymap (`src/content/keymap.ts`).
 */
const COMMANDS = {
  'toggle-overlay': {
    suggested_key: { default: 'Alt+Shift+A', mac: 'Alt+Shift+A' },
    description: 'Show / hide the Audio Punch mixer',
  },
  'toggle-global': {
    suggested_key: { default: 'Alt+Shift+G', mac: 'Alt+Shift+G' },
    description: 'Toggle the global chain on / off',
  },
  'mute-all': {
    suggested_key: { default: 'Alt+Shift+M', mac: 'Alt+Shift+M' },
    description: 'Mute / unmute every captured tab',
  },
  'bypass-all': {
    suggested_key: { default: 'Alt+Shift+B', mac: 'Alt+Shift+B' },
    description: 'Bypass / re-engage all processing',
  },
}

export function makeManifest(target: Target): Record<string, unknown> {
  const base = {
    manifest_version: 3,
    name: 'Audio Punch',
    version: VERSION,
    description:
      'A DJ-style mixing desk for your browser: EQ, dynamics, space and pitch on every tab.',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'Audio Punch — open mixer',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
      },
    },
    options_page: 'dashboard.html',
    content_scripts: [
      {
        matches: ['http://*/*', 'https://*/*'],
        js: ['content.js'],
        run_at: 'document_idle',
        all_frames: false,
      },
    ],
    commands: COMMANDS,
    host_permissions: ['<all_urls>'],
  }

  if (target === 'firefox') {
    // Firefox has neither tabCapture nor offscreen documents; the platform
    // adapter falls back to the media-element engine there.
    return {
      ...base,
      permissions: ['storage', 'tabs', 'activeTab', 'scripting', 'downloads'],
      background: { scripts: ['background.js'], type: 'module' },
      browser_specific_settings: {
        gecko: { id: 'audio-punch@local', strict_min_version: '115.0' },
      },
    }
  }

  return {
    ...base,
    permissions: [
      'tabCapture',
      'offscreen',
      'storage',
      'tabs',
      'activeTab',
      'scripting',
      'downloads',
    ],
    background: { service_worker: 'background.js', type: 'module' },
    minimum_chrome_version: '116',
  }
}

/**
 * Chrome / Edge adapter. The only file in the extension that is allowed to
 * assume `chrome.tabCapture` and offscreen documents exist.
 */
import type { Platform, PlatformTab } from './index.ts'

function toTab(tab: chrome.tabs.Tab): PlatformTab | null {
  if (tab.id === undefined || tab.id < 0) return null
  return {
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url ?? '',
    title: tab.title ?? '',
    favIconUrl: tab.favIconUrl ?? '',
    audible: tab.audible === true,
    active: tab.active === true,
  }
}

export const chromePlatform: Platform = {
  name: 'chrome',

  storage: {
    async read<T>(key: string): Promise<T | null> {
      const bag = await chrome.storage.local.get(key)
      return (bag[key] as T | undefined) ?? null
    },
    async write(key, value) {
      await chrome.storage.local.set({ [key]: value })
    },
    async clear(key) {
      await chrome.storage.local.remove(key)
    },
  },

  tabs: {
    async list() {
      const tabs = await chrome.tabs.query({})
      return tabs.map(toTab).filter((t): t is PlatformTab => t !== null)
    },
    async get(tabId) {
      try {
        return toTab(await chrome.tabs.get(tabId))
      } catch {
        return null
      }
    },
    async activate(tabId) {
      const tab = await chrome.tabs.get(tabId)
      await chrome.windows.update(tab.windowId, { focused: true })
      await chrome.tabs.update(tabId, { active: true })
    },
    async sendMessage(tabId, message) {
      try {
        return await chrome.tabs.sendMessage(tabId, message)
      } catch {
        // No content script in that tab (unsupported page, or not yet injected).
        return null
      }
    },
  },

  async openDashboard() {
    await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') })
  },

  notify(text: string) {
    console.info('[audio-punch]', text)
  },
}

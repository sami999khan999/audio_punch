/**
 * Chrome / Edge adapter. The only file in the extension that is allowed to
 * assume `chrome.tabCapture` and offscreen documents exist.
 */
import type { CaptureHandle, Platform, PlatformTab } from './index.ts'

const OFFSCREEN_PATH = 'offscreen.html'

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

let engineReady: Promise<void> | null = null

async function hasOffscreen(): Promise<boolean> {
  // getContexts is the supported check from Chrome 116 onwards.
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  })
  return contexts.length > 0
}

export const chromePlatform: Platform = {
  name: 'chrome',
  canCaptureTabs: true,

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

  async captureTab(tabId: number): Promise<CaptureHandle> {
    // Promisified by hand: the published typings only describe the callback
    // form, and the callback is also where the "not invoked on this tab"
    // rejection surfaces, via runtime.lastError.
    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        const failure = chrome.runtime.lastError
        if (failure) reject(new Error(failure.message ?? 'Tab capture was refused.'))
        else resolve(id)
      })
    })
    if (!streamId) throw new Error('The browser did not return a capture stream for this tab.')
    return { streamId }
  },

  async ensureEngine() {
    if (engineReady) return engineReady
    engineReady = (async () => {
      if (await hasOffscreen()) return
      try {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_PATH,
          reasons: [chrome.offscreen.Reason.USER_MEDIA],
          justification:
            'Hosts the Web Audio graph that processes captured tab audio and plays it back.',
        })
      } catch (err) {
        // A concurrent call may have created it between the check and here.
        if (!(await hasOffscreen())) {
          engineReady = null
          throw err
        }
      }
    })()
    return engineReady
  },

  async openDashboard() {
    await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') })
  },

  notify(text: string) {
    console.info('[audio-punch]', text)
  },
}

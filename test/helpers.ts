/**
 * An in-memory Platform, so the settings store can be tested without a browser.
 */
import type { Platform, PlatformTab } from '../src/platform/index.ts'

export function fakePlatform(seed: Record<string, unknown> = {}): Platform & {
  written: Record<string, unknown>
} {
  const written: Record<string, unknown> = { ...seed }
  return {
    name: 'chrome',
    written,
    storage: {
      async read<T>(key: string): Promise<T | null> {
        return (written[key] as T | undefined) ?? null
      },
      async write(key, value) {
        written[key] = JSON.parse(JSON.stringify(value))
      },
      async clear(key) {
        delete written[key]
      },
    },
    tabs: {
      async list(): Promise<PlatformTab[]> {
        return []
      },
      async get() {
        return null
      },
      async activate() {},
      async sendMessage() {
        return null
      },
    },
    async openDashboard() {},
    notify() {},
  }
}

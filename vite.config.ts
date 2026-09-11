import { defineConfig, type Plugin } from 'vite'
import { build as esbuild } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeManifest, type Target } from './manifest.config.ts'

const root = dirname(fileURLToPath(import.meta.url))
const target = (process.env.TARGET as Target) ?? 'chrome'
const outDir = resolve(root, 'dist', target)

/**
 * Content scripts and AudioWorklet processors cannot be ES modules:
 * manifest-declared content scripts run as classic scripts, and
 * `audioWorklet.addModule` support for static imports is not dependable.
 * Both are therefore bundled to self-contained IIFEs with esbuild, after
 * Vite has finished writing the module entries.
 */
const IIFE_ENTRIES: Array<{ entry: string; out: string }> = [
  { entry: 'src/content/index.ts', out: 'content.js' },
  { entry: 'src/offscreen/worklets/pitch-shifter.worklet.ts', out: 'worklets/pitch-shifter.js' },
  { entry: 'src/offscreen/worklets/gate.worklet.ts', out: 'worklets/gate.js' },
]

function extensionPlugin(): Plugin {
  return {
    name: 'audio-punch:extension',
    async writeBundle() {
      await mkdir(outDir, { recursive: true })
      await writeFile(
        resolve(outDir, 'manifest.json'),
        JSON.stringify(makeManifest(target), null, 2),
      )

      await Promise.all(
        IIFE_ENTRIES.map(({ entry, out }) =>
          esbuild({
            entryPoints: [resolve(root, entry)],
            outfile: resolve(outDir, out),
            bundle: true,
            format: 'iife',
            target: 'es2022',
            minify: process.env.NODE_ENV === 'production',
            sourcemap: process.env.NODE_ENV !== 'production' ? 'inline' : false,
            legalComments: 'none',
          }),
        ),
      )
    },
  }
}

export default defineConfig({
  plugins: [extensionPlugin()],
  publicDir: resolve(root, 'public'),
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,
    // Extension pages load from disk; readable output is worth more than bytes.
    minify: false,
    rollupOptions: {
      input: {
        background: resolve(root, 'src/background/index.ts'),
        offscreen: resolve(root, 'offscreen.html'),
        dashboard: resolve(root, 'dashboard.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
        // The service worker must be one self-contained file.
        inlineDynamicImports: false,
      },
    },
  },
})

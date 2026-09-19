/// <reference types="vitest/config" />
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Needed on every page load: split out for caching, never lazy. Only eager code goes in manual
// chunks. A manual chunk for the lazy Privy tree also absorbed shared dependencies (React ended up
// in it) and the entry then imported it statically, loading Privy on every visit.
const REACT = /\/node_modules\/(react|react-dom|scheduler)\//

/**
 * Files the page loads up front: the entries in Vite's build manifest and everything they import
 * statically, with their CSS. Dynamic imports (the Privy email path, the mock worker) are not
 * followed, so they are fetched only when used, never precached by the service worker.
 */
function eagerAssets(manifestFile: string): Set<string> {
  type Chunk = { file: string; css?: string[]; imports?: string[]; isEntry?: boolean }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, Chunk>
  const files = new Set<string>()
  const seen = new Set<string>()
  const visit = (key: string) => {
    if (seen.has(key) || !manifest[key]) return
    seen.add(key)
    const chunk = manifest[key]
    files.add(chunk.file)
    chunk.css?.forEach((css) => files.add(css))
    chunk.imports?.forEach(visit)
  }
  Object.keys(manifest)
    .filter((key) => manifest[key].isEntry)
    .forEach(visit)
  return files
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Workbox refuses to precache anything over 2 MB by default, which failed the Amplify build.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Setting this replaces workbox's default (node_modules); the SW, its runtime and Vite's
        // build manifest never belong in the precache.
        globIgnores: ['**/node_modules/**/*', 'sw.js', 'workbox-*.js', '.vite/**'],
        // Precache only what the page loads up front. Precaching the lazy Privy chunks would
        // download them on every first visit, undoing the lazy load.
        manifestTransforms: [
          (entries) => {
            const eager = eagerAssets(path.resolve(__dirname, 'dist/.vite/manifest.json'))
            return { manifest: entries.filter((e) => !e.url.startsWith('assets/') || eager.has(e.url)), warnings: [] }
          },
        ],
      },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'LiraLink Pay',
        short_name: 'LiraLink',
        description: 'Pay a LiraLink invoice with USDC on Stellar',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  build: {
    // Read by eagerAssets() for the service-worker precache.
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return
          if (REACT.test(id)) return 'react'
          if (id.includes('/node_modules/@stellar/')) return 'stellar-sdk'
          if (id.includes('/node_modules/@creit.tech/')) return 'wallets-kit'
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      buffer: 'buffer/',
    },
  },
  define: {
    global: 'globalThis',
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
})

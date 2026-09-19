/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The Privy email path and the WalletConnect tree it drags in. Only reachable through the lazy
// PrivyEmailFlow import, so this chunk is fetched when a payer picks email sign-in, never before.
const PRIVY_TREE = /\/node_modules\/(@privy-io|@walletconnect|@reown|viem|ox|abitype)\//

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Workbox refuses to precache anything over 2 MB by default, which failed the Amplify build.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Precaching the Privy chunk would download it on every first visit, undoing the lazy load.
        // Setting this replaces workbox's default (node_modules); the SW and its runtime never belong in the precache.
        globIgnores: ['**/node_modules/**/*', 'sw.js', 'workbox-*.js', '**/privy-*.js'],
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return
          if (id.includes('/node_modules/@stellar/')) return 'stellar-sdk'
          if (id.includes('/node_modules/@creit.tech/')) return 'wallets-kit'
          if (PRIVY_TREE.test(id)) return 'privy'
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

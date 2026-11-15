import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Start connecting to the database while the app is still loading. The address comes from the
// same setting the app uses (VITE_SUPABASE_URL), so it is always the database actually in use.
function preconnectDatabase(mode) {
  return {
    name: 'preconnect-database',
    transformIndexHtml() {
      const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
      let origin = '';
      try { origin = new URL(env.VITE_SUPABASE_URL).origin; } catch { return []; }
      return [
        { tag: 'link', attrs: { rel: 'preconnect', href: origin, crossorigin: '' }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'dns-prefetch', href: origin }, injectTo: 'head' },
      ];
    },
  };
}

export default defineConfig(({ mode }) => ({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', 'lucide-react'],
          supabase: ['@supabase/supabase-js']
        }
      }
    }
  },
  plugins: [
    preconnectDatabase(mode),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Hardware POS System',
        short_name: 'HardwarePOS',
        description: 'Offline-capable Point of Sale System',
        theme_color: '#121212',
        background_color: '#121212',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png'
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        // + the Latin / Latin-extended Inter font files (incl. ₹) so text looks the same offline
        globPatterns: ['**/*.{js,css,html,ico,png,svg}', '**/inter-latin*-normal-*.woff2'],
        globIgnores: ['**/exceljs*'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 4000000,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('exceljs'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'excel-assets-cache',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 Days
              },
            },
          },
        ],
      },
      devOptions: {
        // main.jsx unregisters service workers on localhost, so the dev SW was never used
        enabled: false
      }
    })
  ],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: './vitest.setup.js',
    // Dummy values so modules that create the Supabase client can be imported in tests.
    // No test talks to a real server.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  }
}))

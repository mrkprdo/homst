import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import { VitePWA } from "vite-plugin-pwa"
import { resolve } from "path"

// Local `bun run dev` reaches the host API; inside the dev container the API is
// a sibling service, so compose sets this to http://api-dev:8000.
const apiTarget = process.env.VITE_API_PROXY_TARGET || "http://localhost:8000"

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      workbox: {
        // Pull the Web Push handlers into the generated service worker.
        importScripts: ["/push-sw.js"],
        // Uploaded photos are large, immutable (UUID filenames) and shown over
        // and over by the slideshow. Keep them in the browser cache so a kiosk
        // does not re-download the album on every reload or slide change. The
        // seven-day TTL only bounds disk use for photos that were deleted.
        runtimeCaching: [
          {
            urlPattern: /\/uploads\/photos\/[^/]+$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "homst-photos",
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "HOMST",
        short_name: "HOMST",
        description: "Household management",
        theme_color: "#f3edd6",
        background_color: "#f3edd6",
        display: "standalone",
        scope: "/",
        start_url: "/",
        icons: [
          // Version query busts browser/OS caches when the artwork changes
          { src: "/icon-192.png?v=2", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png?v=2", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        // Keep the browser's host in X-Forwarded-Host. changeOrigin rewrites
        // Host to the API target (api-dev:8000), and the API rejects writes
        // whose Origin host does not match the request host — so without this
        // every POST/PATCH/DELETE through the dev server returned 403.
        xfwd: true,
      },
      // Uploaded photos are served by the API at /uploads, not bundled by Vite.
      // Without this route the SPA history fallback answers image requests with
      // index.html (and direct visits "redirect" into the dashboard).
      "/uploads": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})

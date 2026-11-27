import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import { VitePWA } from "vite-plugin-pwa"
import { resolve } from "path"

const apiTarget = process.env.VITE_API_PROXY_TARGET || "http://localhost:8000"

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      workbox: {
        importScripts: ["/push-sw.js"],
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
    allowedHosts: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        xfwd: true,
      },
      "/uploads": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})

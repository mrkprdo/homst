import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import { VitePWA } from "vite-plugin-pwa"
import { resolve } from "path"

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      workbox: {
        // Pull the Web Push handlers into the generated service worker.
        importScripts: ["/push-sw.js"],
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
        // Local `bun run dev` reaches the host API; inside the dev container the
        // API is a sibling service, so compose sets this to http://api-dev:8000.
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
})

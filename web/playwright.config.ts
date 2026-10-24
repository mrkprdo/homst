import { defineConfig, devices } from "@playwright/test"

// Point the same suite at a built image with E2E_BASE_URL, e.g.
//   E2E_BASE_URL=https://localhost:18443 bun run e2e
// When set, Playwright skips the Vite dev server and ignores the local CA.
const baseURL = process.env.E2E_BASE_URL || "http://localhost:5173"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  timeout: 60000,

  use: {
    baseURL,
    // The suite mocks the API with page.route; a live service worker would
    // bypass those routes, so keep it out of UI tests.
    serviceWorkers: "block",
    ignoreHTTPSErrors: Boolean(process.env.E2E_BASE_URL),
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "bun run dev",
        url: "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
})

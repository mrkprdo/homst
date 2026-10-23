import { defineConfig } from "vitest/config"
import vue from "@vitejs/plugin-vue"
import { resolve } from "path"

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/__tests__/**/*.test.ts"],
    // The suite mounts large views many times; a cold coverage run can take
    // longer than Vitest's 5s default without anything being wrong.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,vue}"],
      exclude: [
        "src/__tests__/**",
        "src/env.d.ts",
        "src/main.ts",
      ],
      // Every executable line must be exercised. Template-rendered branches
      // and V8 statement/function counters are reported but not gated; V8
      // counts compiled template callbacks that no user interaction reaches.
      thresholds: {
        lines: 100,
      },
    },
  },
})

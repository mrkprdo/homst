import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { createRouter, createWebHistory } from "vue-router"
import App from "@/App.vue"

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", component: { template: "<div />" } }],
})

const originalUrl = window.location.href

describe("App — notification tap while the server is unreachable", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
  })

  afterEach(() => {
    window.history.replaceState({}, "", originalUrl)
  })

  it("opens the stored push view instead of staying blank", async () => {
    window.history.replaceState({}, "", "/?announcement=ann-1&push=push-1")
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"))

    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    await flushPromises()

    expect(wrapper.find(".offline-push").exists()).toBe(true)
    expect(wrapper.text()).toContain("HOMST's local server is out of reach")
    expect(wrapper.text()).toContain("not stored on this device")
    expect(window.location.search).toBe("")
    wrapper.unmount()
  })
})

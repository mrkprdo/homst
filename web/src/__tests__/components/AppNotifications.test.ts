import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { createRouter, createWebHistory } from "vue-router"
import App from "@/App.vue"
import { useUi } from "@/composables/useUi"
import { useOfflineNotifications } from "@/composables/useOfflineNotifications"
import { _resetNotificationIntent } from "@/composables/useNotificationIntent"

vi.mock("@/lib/pushStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pushStore")>()
  return {
    ...actual,
    listStoredPushes: vi.fn().mockResolvedValue([
      {
        id: "push-1",
        title: "Stored reminder",
        body: "Soccer starts soon",
        url: "/?event=ev-1&event_start=10",
        received_at: 1_767_225_600_000,
      },
    ]),
  }
})

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", component: { template: "<div />" } }],
})

const originalUrl = window.location.href

function installFetch() {
  vi.mocked(fetch).mockImplementation(async (url) => {
    const path = String(url)
    if (path.includes("/api/health")) return new Response("{}", { status: 200 })
    if (path.includes("/household/settings")) {
      return new Response(JSON.stringify({ isComplete: true }), { status: 200 })
    }
    return new Response(JSON.stringify([]), { status: 200 })
  })
}

beforeEach(() => {
  _resetNotificationIntent()
  installFetch()
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
  vi.mocked(fetch).mockReset()
})

describe("App notification intents", () => {
  it("opens the calendar drawer for an event deep link", async () => {
    window.history.replaceState({}, "", "/?event=ev-1&event_start=1767225600")
    const ui = useUi()
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    await flushPromises()

    expect(ui.activePanel.value).toBe("calendar")
    expect(ui.drawer.value.type).toBe("event-detail")
    expect(ui.drawer.value.id).toBe("ev-1")
    wrapper.unmount()
  })

  it("opens the announcement panel for an announcement deep link", async () => {
    window.history.replaceState({}, "", "/?announcement=ann-1")
    const ui = useUi()
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    await flushPromises()

    expect(ui.activePanel.value).toBe("announcements")
    wrapper.unmount()
  })

  it("still opens the event when its data cannot load", async () => {
    window.history.replaceState({}, "", "/?event=ev-1&event_start=1767225600")
    vi.mocked(fetch).mockImplementation(async (url) => {
      const path = String(url)
      if (path.includes("/events")) {
        return new Response(JSON.stringify({ detail: "bad data" }), { status: 500 })
      }
      if (path.includes("/api/health")) return new Response("{}", { status: 200 })
      if (path.includes("/household/settings")) {
        return new Response(JSON.stringify({ isComplete: true }), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })

    const ui = useUi()
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    await flushPromises()
    expect(ui.activePanel.value).toBe("calendar")
    expect(ui.drawer.value.type).toBe("event-detail")
    wrapper.unmount()
  })

  it("ignores a plain push deep link", async () => {
    window.history.replaceState({}, "", "/?push=push-1")
    const ui = useUi()
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    await flushPromises()

    expect(ui.activePanel.value).toBe("home")
    expect(ui.drawer.value.type).toBeNull()
    wrapper.unmount()
  })
})

describe("App reachability", () => {
  it("reacts to online, offline, and visibility events", async () => {
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/health"))
    const before = calls.length

    window.dispatchEvent(new Event("offline"))
    await flushPromises()
    expect(wrapper.find(".server-offline").exists()).toBe(true)

    window.dispatchEvent(new Event("online"))
    await flushPromises()
    await flushPromises()
    expect(wrapper.find(".server-offline").exists()).toBe(false)

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
    document.dispatchEvent(new Event("visibilitychange"))
    await flushPromises()
    const after = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/health"))
    expect(after.length).toBeGreaterThan(before)
    wrapper.unmount()
  })

  it("opens and closes the stored offline notifications", async () => {
    window.history.replaceState({}, "", "/?announcement=ann-1&push=push-1")
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"))
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    await flushPromises()

    expect(wrapper.find(".offline-push").exists()).toBe(true)
    const offline = useOfflineNotifications()
    offline.items.value = [
      {
        id: "push-1",
        title: "Stored reminder",
        body: "Soccer starts soon",
        url: "/?event=ev-1&event_start=10",
        received_at: 1_767_225_600_000,
      },
    ]
    offline.loaded.value = true
    await flushPromises()
    await wrapper.find(".offline-push__done").trigger("click")
    await flushPromises()
    expect(wrapper.find(".offline-push").exists()).toBe(false)

    await wrapper.find(".server-offline__action").trigger("click")
    await flushPromises()
    await flushPromises()
    expect(wrapper.find(".offline-push").exists()).toBe(true)
    wrapper.unmount()
  })
})

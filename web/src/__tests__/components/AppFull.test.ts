import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { nextTick } from "vue"
import { mount, flushPromises } from "@vue/test-utils"
import { createRouter, createWebHistory } from "vue-router"
import App from "@/App.vue"
import { useUi } from "@/composables/useUi"
import { useSettings } from "@/composables/useSettings"
import MobileShell from "@/components/mobile/MobileShell.vue"
import MobileOnboardingGate from "@/components/mobile/MobileOnboardingGate.vue"

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", component: { template: "<div />" } }],
})

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

function mockApi(settingsBody: unknown = {}) {
  vi.mocked(fetch).mockImplementation(((input: any) => {
    const url = String(input)
    if (url.includes("/household/settings")) return Promise.resolve(json(settingsBody))
    return Promise.resolve(json([]))
  }) as any)
}

function mountApp(extra: any = {}) {
  return mount(App, {
    global: { plugins: [router], ...(extra.global ?? {}) },
  })
}

/** Wait for the app's async bootstrap (`getSettings().then/.finally`). */
async function settle() {
  for (let i = 0; i < 6; i++) await nextTick()
}

/** Like {@link settle}, but also drains macrotasks — only safe with real timers. */
async function settleFully() {
  await flushPromises()
  await settle()
}

beforeEach(() => {
  mockApi({})
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
  vi.useRealTimers()
})

describe("App — bootstrap, idle cycle and cleanup", () => {
  // NOTE: `isMobile` is a module-level computed in App.vue. Its deps are not
  // reactive, so it caches on first evaluation — this must run before any
  // desktop mount in this file.
  it("runs the mobile branch: onboarding gate then shell", async () => {
    const ua = window.navigator.userAgent
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    })
    try {
      mockApi({ isComplete: false })
      const wrapper = mountApp()
      await settleFully()

      const gate = wrapper.findComponent(MobileOnboardingGate)
      expect(gate.exists()).toBe(true)
      expect(wrapper.findComponent(MobileShell).exists()).toBe(false)

      gate.vm.$emit("joined")
      await settleFully()
      expect(wrapper.findComponent(MobileOnboardingGate).exists()).toBe(false)
      expect(wrapper.findComponent(MobileShell).exists()).toBe(true)

      wrapper.unmount()
    } finally {
      Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: ua })
    }
  })

  it("applies theme, accent, font, warm and timezone from household settings", async () => {
    const settings = useSettings()
    mockApi({ isComplete: true, theme: "dark", themePreset: "default", accentColor: "sage", fontSize: "large", warm: true })
    const wrapper = mountApp()
    await settleFully()

    expect(settings.theme.value).toBe("dark")
    expect(settings.accentColor.value).toBe("sage")
    expect(settings.fontSize.value).toBe("large")
    expect(settings.warm.value).toBe(true)

    // Timezone is written back once because the household hasn't stored one
    const patches = vi.mocked(fetch).mock.calls.filter(
      (c) => String(c[0]).includes("/household/settings") && (c[1] as any)?.method === "PATCH",
    )
    expect(patches.length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it("applies a stored theme preset and its accent", async () => {
    const settings = useSettings()
    mockApi({ isComplete: true, theme: "light", themePreset: "futur", accentColor: "mint", fontSize: "large" })
    const wrapper = mountApp()
    await settleFully()

    expect(settings.themePreset.value).toBe("futur")
    expect(settings.accentColor.value).toBe("mint")
    expect(document.documentElement.classList.contains("futur")).toBe(true)
    wrapper.unmount()
  })

  it("rotates the active panel once the kiosk goes idle", async () => {
    vi.useFakeTimers()
    const ui = useUi()
    ui.setPanel("home")
    const wrapper = mountApp()
    await settle()
    expect(ui.activePanel.value).toBe("home")

    await vi.advanceTimersByTimeAsync(120_000)
    expect(ui.activePanel.value).toBe("calendar")

    await vi.advanceTimersByTimeAsync(120_000)
    expect(ui.activePanel.value).toBe("tasks")

    wrapper.unmount()
  })

  it("keeps the current panel while the drawer is open", async () => {
    vi.useFakeTimers()
    const ui = useUi()
    ui.setPanel("home")
    ui.isDrawerOpen.value = true
    const wrapper = mountApp()
    await settle()

    await vi.advanceTimersByTimeAsync(120_000)
    expect(ui.activePanel.value).toBe("home")
    wrapper.unmount()
  })

  it("keeps the current panel after a recent interaction", async () => {
    vi.useFakeTimers()
    const ui = useUi()
    ui.setPanel("home")
    const wrapper = mountApp()
    await settle()

    await vi.advanceTimersByTimeAsync(95_000)
    window.dispatchEvent(new Event("pointerdown"))
    await vi.advanceTimersByTimeAsync(25_000)
    // < 30s since the last interaction → the rotation is deferred
    expect(ui.activePanel.value).toBe("home")
    wrapper.unmount()
  })

  it("debounces mousemove tracking and stops listening after unmount", async () => {
    vi.useFakeTimers()
    const wrapper = mountApp()
    await settle()

    window.dispatchEvent(new Event("mousemove"))
    window.dispatchEvent(new Event("mousemove"))
    await vi.advanceTimersByTimeAsync(300)

    window.dispatchEvent(new Event("mousemove"))
    const pending = vi.getTimerCount()
    wrapper.unmount()
    expect(vi.getTimerCount()).toBeLessThan(pending)

    window.dispatchEvent(new Event("mousemove"))
    expect(vi.getTimerCount()).toBeLessThan(pending)
  })

  it("renders the drawer panel that matches the open drawer type", async () => {
    const ui = useUi()
    const wrapper = mountApp({
      global: {
        stubs: {
          teleport: true,
          MemberDetailPanel: { template: '<div class="stub-member" />' },
          EventDetailPanel: { template: '<div class="stub-event" />' },
          TaskDetailPanel: { template: '<div class="stub-task" />' },
        },
      },
    })
    await settleFully()

    ui.openDrawer("member-detail", "m1")
    await settle()
    expect(wrapper.find(".stub-member").exists()).toBe(true)

    ui.openDrawer("event-detail", "e1")
    await settle()
    expect(wrapper.find(".stub-event").exists()).toBe(true)

    ui.openDrawer("task-detail", "t1")
    await settle()
    expect(wrapper.find(".stub-task").exists()).toBe(true)

    wrapper.unmount()
  })
})

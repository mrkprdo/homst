import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { createRouter, createWebHistory } from "vue-router"
import App from "@/App.vue"
import { useUi } from "@/composables/useUi"
import { useSettings } from "@/composables/useSettings"

const matchMediaMock = vi.fn().mockReturnValue({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", component: { template: "<div />" } }],
})

describe("App", () => {
  beforeEach(() => {
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaMock,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mountApp() {
    return mount(App, {
      global: { plugins: [router] },
    })
  }

  it("renders AppNav", () => {
    const wrapper = mountApp()
    expect(wrapper.findComponent({ name: "AppNav" }).exists()).toBe(true)
  })

  it("renders main panel", () => {
    const wrapper = mountApp()
    expect(wrapper.find(".main-panel").exists()).toBe(true)
  })

  it("renders DrawerOverlay", () => {
    const wrapper = mountApp()
    expect(wrapper.findComponent({ name: "DrawerOverlay" }).exists()).toBe(true)
  })

  it("renders home by default", () => {
    const wrapper = mountApp()
    expect(wrapper.find(".home-view").exists()).toBe(true)
  })

  it("can mount with tasks as active panel", () => {
    const ui = useUi()
    ui.setPanel("tasks")
    const wrapper = mountApp()
    expect(wrapper.find(".tasks-view").exists()).toBe(true)
  })

  it("can mount with settings as active panel", () => {
    const ui = useUi()
    ui.setPanel("settings")
    const wrapper = mountApp()
    expect(wrapper.find(".settings-panel").exists()).toBe(true)
  })

  it("applies dark class to html when theme is dark", async () => {
    const settings = useSettings()
    settings.updateTheme("dark")
    mountApp()
    await nextTick()
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("does not apply dark class to html when theme is light", () => {
    const settings = useSettings()
    settings.updateTheme("light")
    mountApp()
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("does not apply dark class to html when system prefers light", () => {
    const settings = useSettings()
    settings.updateTheme("system")
    mountApp()
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("uses the server day/night state when theme is auto", async () => {
    const settings = useSettings()
    settings.updateTheme("auto")
    settings.autoThemeDark.value = true
    const wrapper = mountApp()
    await nextTick()
    expect(document.documentElement.classList.contains("dark")).toBe(true)

    settings.autoThemeDark.value = false
    await nextTick()
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    wrapper.unmount()
  })

  it("falls back to the OS preference until auto state arrives", async () => {
    let changeHandler: ((e: MediaQueryListEvent) => void) | null = null
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
        if (event === "change") changeHandler = handler
      }),
      removeEventListener: vi.fn(),
    })
    const settings = useSettings()
    settings.updateTheme("auto")
    mountApp()

    changeHandler!({ matches: true } as MediaQueryListEvent)
    await nextTick()
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("applies warm class to html when warm lighting is on", async () => {
    const settings = useSettings()
    settings.updateWarm(true)
    mountApp()
    await nextTick()
    expect(document.documentElement.classList.contains("warm")).toBe(true)
  })

  it("does not apply warm class to html when warm lighting is off", () => {
    const settings = useSettings()
    settings.updateWarm(false)
    mountApp()
    expect(document.documentElement.classList.contains("warm")).toBe(false)
  })

  it("adds theme-transitioning class to app-root during theme change and removes it", async () => {
    vi.useFakeTimers()
    const settings = useSettings()
    const wrapper = mountApp()
    settings.updateTheme("dark")
    await nextTick()
    expect(wrapper.find(".app-root").classes()).toContain("theme-transitioning")
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(wrapper.find(".app-root").classes()).not.toContain("theme-transitioning")
    vi.useRealTimers()
  })

  it("app-root has theme-ready class", async () => {
    const wrapper = mountApp()
    await nextTick()
    expect(wrapper.find(".app-root").exists()).toBe(true)
  })

  it("registers matchMedia listener on mount", () => {
    const addSpy = vi.fn()
    const removeSpy = vi.fn()
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: addSpy,
      removeEventListener: removeSpy,
    })
    mountApp()
    expect(addSpy).toHaveBeenCalledWith("change", expect.any(Function))
  })

  it("unregisters matchMedia listener on unmount", () => {
    const addSpy = vi.fn()
    const removeSpy = vi.fn()
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: addSpy,
      removeEventListener: removeSpy,
    })
    const wrapper = mountApp()
    wrapper.unmount()
    expect(removeSpy).toHaveBeenCalledWith("change", expect.any(Function))
  })

  it("media query change toggles dark mode on html when theme is system", async () => {
    let changeHandler: ((e: MediaQueryListEvent) => void) | null = null
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
        if (event === "change") changeHandler = handler
      }),
      removeEventListener: vi.fn(),
    })
    const settings = useSettings()
    settings.updateTheme("system")
    mountApp()

    changeHandler!({ matches: true } as MediaQueryListEvent)
    await nextTick()
    expect(document.documentElement.classList.contains("dark")).toBe(true)

    changeHandler!({ matches: false } as MediaQueryListEvent)
    await nextTick()
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("all panels are mountable", () => {
    const panels = [
      { panel: "tasks" as const, cls: "tasks-view" },
      { panel: "settings" as const, cls: "settings-panel" },
      { panel: "calendar" as const, cls: "calendar-view" },
    ]
    for (const { panel, cls } of panels) {
      const ui = useUi()
      ui.setPanel(panel)
      const wrapper = mountApp()
      expect(wrapper.find(`.${cls}`).exists()).toBe(true)
    }
  })

  it("page cycle timer does not rotate when drawer is open", async () => {
    vi.useFakeTimers()
    const ui = useUi()
    ui.isDrawerOpen.value = true
    mountApp()
    const initialPanel = ui.activePanel.value

    vi.advanceTimersByTime(20000)
    await nextTick()

    expect(ui.activePanel.value).toBe(initialPanel)
    vi.useRealTimers()
  })

  it("page cycle timer does not rotate after recent interaction", async () => {
    vi.useFakeTimers()
    const ui = useUi()
    mountApp()
    window.dispatchEvent(new PointerEvent("pointerdown"))
    const initialPanel = ui.activePanel.value

    vi.advanceTimersByTime(20000)
    await nextTick()

    expect(ui.activePanel.value).toBe(initialPanel)
    vi.useRealTimers()
  })

  it("registers idle timer listeners", () => {
    const addSpy = vi.spyOn(window, "addEventListener")
    mountApp()
    expect(addSpy).toHaveBeenCalledWith("pointerdown", expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith("wheel", expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith("mousemove", expect.any(Function))
  })

  it("registers and cleans up event listeners on mount/unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener")
    const removeSpy = vi.spyOn(window, "removeEventListener")

    const wrapper = mountApp()
    // Four idle listeners plus online and offline (visibilitychange is on document).
    expect(addSpy).toHaveBeenCalledTimes(6)

    wrapper.unmount()
    expect(removeSpy).toHaveBeenCalledWith("pointerdown", expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith("wheel", expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith("mousemove", expect.any(Function))
  })
})

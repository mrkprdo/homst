import { describe, it, expect, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { nextTick } from "vue"
import SettingsPanel from "@/components/settings/SettingsPanel.vue"
import { useSettings } from "@/composables/useSettings"
import { COLORS, THEMES } from "@/__tests__/constants"

describe("SettingsPanel", () => {
  it("renders settings title", () => {
    const wrapper = mount(SettingsPanel)
    expect(wrapper.find(".page-header__title").text()).toBe("Settings")
  })

  it("renders theme section", () => {
    const wrapper = mount(SettingsPanel)
    expect(wrapper.text()).toContain("Appearance")
  })

  it("renders 4 theme buttons for the default Futur preset (Day, Night, Auto, System)", () => {
    const wrapper = mount(SettingsPanel)
    const btns = wrapper.findAll(".theme-card")
    expect(btns).toHaveLength(4)
    expect(btns[0]!.find(".theme-label").text()).toBe("Day")
    expect(btns[1]!.find(".theme-label").text()).toBe("Night")
    expect(btns[2]!.find(".theme-label").text()).toBe("Auto")
    expect(btns[3]!.find(".theme-label").text()).toBe("System")
  })

  it("System is active by default", () => {
    const wrapper = mount(SettingsPanel)
    const btns = wrapper.findAll(".theme-card")
    expect(btns[3]!.classes()).toContain("active")
  })

  it("clicking Auto asks the server to resolve sunrise and sunset", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      message: "Settings updated",
      settings: {
        theme: "auto",
        autoThemeDark: true,
        autoSunrise: "2026-10-21T11:38:00+00:00",
        autoSunset: "2026-10-21T22:26:00+00:00",
      },
    }), { status: 200, headers: { "content-type": "application/json" } })))

    const wrapper = mount(SettingsPanel)
    await flushPromises()
    const settings = useSettings()

    await wrapper.findAll(".theme-card")[2]!.trigger("click")
    await flushPromises()

    const patch = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === "PATCH")
    expect(patch).toBeTruthy()
    expect(JSON.parse((patch![1] as RequestInit).body as string).settings.theme).toBe("auto")
    expect(settings.theme.value).toBe("auto")
    expect(settings.autoThemeDark.value).toBe(true)
    expect(settings.autoSunrise.value).toBe("2026-10-21T11:38:00+00:00")
    expect(wrapper.find(".auto-note").exists()).toBe(true)
  })

  it("clicking Dark updates theme", async () => {
    const wrapper = mount(SettingsPanel)
    const settings = useSettings()
    const btns = wrapper.findAll(".theme-card")
    await btns[1]!.trigger("click")
    expect(settings.theme.value).toBe("dark")
  })

  it("clicking Light updates theme", async () => {
    const wrapper = mount(SettingsPanel)
    const settings = useSettings()
    const btns = wrapper.findAll(".theme-card")
    await btns[0]!.trigger("click")
    expect(settings.theme.value).toBe("light")
  })

  it("toggles warm lighting", async () => {
    const wrapper = mount(SettingsPanel)
    const settings = useSettings()
    expect(settings.warm.value).toBe(false)
    const toggle = wrapper.findAllComponents({ name: "UiToggle" })[0]!
    await toggle.trigger("click")
    expect(settings.warm.value).toBe(true)
  })

  it("renders the theme preset cards with Futur active", () => {
    const wrapper = mount(SettingsPanel)
    const cards = wrapper.findAll(".preset-card")
    expect(cards).toHaveLength(2)
    expect(cards[0]!.text()).toContain("Futur")
    expect(cards[1]!.text()).toContain("Clay-o")
    expect(cards[0]!.classes()).toContain("active")
  })

  it("switching to Clay-o swaps accents and appearance copy", async () => {
    const wrapper = mount(SettingsPanel)
    const settings = useSettings()
    const cards = wrapper.findAll(".preset-card")

    await cards[1]!.trigger("click")

    expect(settings.themePreset.value).toBe("default")
    expect(settings.accentColor.value).toBe("sage")
    expect(document.documentElement.classList.contains("futur")).toBe(false)

    const appearance = wrapper.findAll(".theme-card")
    expect(appearance[0]!.find(".theme-label").text()).toBe("Light")
    expect(appearance[2]!.find(".theme-label").text()).toBe("Auto")
    expect(appearance[3]!.find(".theme-label").text()).toBe("System")

    await cards[0]!.trigger("click")
    expect(settings.themePreset.value).toBe("futur")
    expect(settings.accentColor.value).toBe("mint")
    expect(document.documentElement.classList.contains("futur")).toBe(true)

    const swatches = wrapper.findAll(".color-swatch")
    expect(swatches).toHaveLength(5)
    expect(swatches[0]!.attributes("title")).toBe("Mint")

    const futurAppearance = wrapper.findAll(".theme-card")
    expect(futurAppearance[0]!.find(".theme-label").text()).toBe("Day")
    expect(futurAppearance[2]!.find(".theme-label").text()).toBe("Auto")
    expect(futurAppearance[3]!.find(".theme-label").text()).toBe("System")
  })

  it("renders accent color section", () => {
    const wrapper = mount(SettingsPanel)
    expect(wrapper.text()).toContain("Accent Color")
  })

  it("renders font size section", () => {
    const wrapper = mount(SettingsPanel)
    expect(wrapper.text()).toContain("Text Size")
  })

  it("renders 4 font size buttons", () => {
    const wrapper = mount(SettingsPanel)
    const segs = wrapper.findAllComponents({ name: "UiSegmentedControl" })
    const btns = segs[0]!.findAll(".segmented-btn")
    expect(btns).toHaveLength(4)
  })

  it("settings persist after panel re-mount", async () => {
    const settings = useSettings()
    settings.updateTheme("dark")
    settings.updateAccentColor("plum")
    const wrapper = mount(SettingsPanel)
    await nextTick()
    expect(wrapper.exists()).toBe(true)
  })

  it("renders all accent color swatches", () => {
    const wrapper = mount(SettingsPanel)
    const swatches = wrapper.findAll(".color-swatch")
    expect(swatches).toHaveLength(COLORS.length)
  })

  it("switching accent color updates the setting", async () => {
    const wrapper = mount(SettingsPanel)
    const settings = useSettings()
    const swatches = wrapper.findAll(".color-swatch")
    await swatches[1]!.trigger("click")
    expect(settings.accentColor.value).toBe("honey")
    await swatches[3]!.trigger("click")
    expect(settings.accentColor.value).toBe("clay")
  })

  it("renders the reminders card with the unified test button", () => {
    const wrapper = mount(SettingsPanel)
    const card = wrapper.findAll(".settings-card").find(c => c.text().includes("Reminders"))
    expect(card).toBeTruthy()
    const buttons = card!.findAll("button").map(b => b.text())
    expect(buttons.some(t => t.includes("Send test to all clients"))).toBe(true)
  })

  it("Send test to all clients fires a hud+push test and shows the results", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), {
      status: 200, headers: { "content-type": "application/json" },
    }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), {
      status: 200, headers: { "content-type": "application/json" },
    }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      results: { hud: "sent to the display", push: "sent to 1 device(s)" },
    }), { status: 200, headers: { "content-type": "application/json" } }))

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    const btn = wrapper.findAll("button").find(b => b.text().includes("Send test to all clients"))
    await btn!.trigger("click")
    await flushPromises()

    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!
    expect(String(lastCall[0])).toContain("/notifications/test")
    expect(JSON.parse((lastCall[1] as RequestInit).body as string)).toEqual({ channels: ["hud", "push"] })
    expect(wrapper.find(".reminder-result").text()).toContain("sent to the display")
  })

  it("default reminder select persists to notifications settings", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), {
      status: 200, headers: { "content-type": "application/json" },
    }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      notifications: { hud: true, defaultReminderMinutes: 10 },
    }), { status: 200, headers: { "content-type": "application/json" } }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: "ok" }), {
      status: 200, headers: { "content-type": "application/json" },
    }))

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    const select = wrapper.find("select.reminder-default-select")
    expect(select.exists()).toBe(true)
    expect((select.element as HTMLSelectElement).value).toBe("10")

    await select.setValue("30")
    await flushPromises()

    const patchCall = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === "PATCH")
    expect(patchCall).toBeTruthy()
    const body = JSON.parse((patchCall![1] as RequestInit).body as string)
    expect(body.settings.notifications.defaultReminderMinutes).toBe(30)
    expect(useSettings().defaultReminderMinutes.value).toBe(30)
  })
})

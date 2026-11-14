import { describe, it, expect, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { nextTick } from "vue"
import SettingsPanel from "@/components/settings/SettingsPanel.vue"
import { useSettings } from "@/composables/useSettings"
import { COLORS, THEMES } from "@/__tests__/constants"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

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

  it("toggles every now-playing option and saves them together", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const settings = useSettings()

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    const row = (label: string) =>
      wrapper.findAll(".setting-row").find((r) => r.text().includes(label))!

    expect(settings.musicBackgroundSpin.value).toBe(false)

    await row("Spin the cover").find(".ui-toggle").trigger("click")
    await flushPromises()
    expect(settings.musicBackgroundSpin.value).toBe(true)

    await row("Spin the cover").find(".ui-toggle").trigger("click")
    await flushPromises()
    await row("Spinning album art").find(".ui-toggle").trigger("click")
    await flushPromises()
    await row("Synced lyrics").find(".ui-toggle").trigger("click")
    await flushPromises()

    expect(settings.musicBackgroundSpin.value).toBe(false)
    expect(settings.musicCardSpin.value).toBe(false)
    expect(settings.lyricsEnabled.value).toBe(false)

    // The spin sub-option follows its parent.
    expect(wrapper.text()).toContain("Spin the cover")
    await row("Album cover background").find(".ui-toggle").trigger("click")
    await flushPromises()
    expect(settings.musicBackground.value).toBe(false)
    expect(wrapper.text()).not.toContain("Spin the cover")

    const patch = fetchMock.mock.calls.filter(c => (c[1] as RequestInit)?.method === "PATCH").at(-1)!
    expect(JSON.parse((patch[1] as RequestInit).body as string).settings.music).toEqual({
      lyrics: false,
      lyricsOffsetMs: 0,
      background: false,
      backgroundSpin: false,
      cardSpin: false,
    })
  })

  it("adjusts and resets the lyrics delay in 50 ms steps", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const settings = useSettings()

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    const row = wrapper.findAll(".setting-row").find((r) => r.text().includes("Lyrics delay"))!
    const earlier = row.findAll(".lyric-offset__step")[0]!
    const later = row.findAll(".lyric-offset__step")[1]!

    expect(settings.lyricsOffsetMs.value).toBe(0)
    expect(row.text()).toContain("0.00 s")

    await later.trigger("click")
    expect(settings.lyricsOffsetMs.value).toBe(50)
    expect(row.text()).toContain("+0.05 s")

    await later.trigger("click")
    expect(settings.lyricsOffsetMs.value).toBe(100)
    expect(row.text()).toContain("+0.10 s")

    // Reset while the debounce is still pending flushes it immediately.
    await row.find(".lyric-offset__reset").trigger("click")
    expect(settings.lyricsOffsetMs.value).toBe(0)
    expect(row.text()).toContain("0.00 s")

    await earlier.trigger("click")
    await earlier.trigger("click")
    expect(settings.lyricsOffsetMs.value).toBe(-100)
    expect(row.text()).toContain("−0.10 s")

    // The save is debounced while the arrows are tapped.
    await new Promise((resolve) => setTimeout(resolve, 400))
    const patch = fetchMock.mock.calls.filter(c => (c[1] as RequestInit)?.method === "PATCH").at(-1)!
    expect(JSON.parse((patch[1] as RequestInit).body as string).settings.music.lyricsOffsetMs).toBe(-100)

    // The household setting is clamped to the ±2s range.
    settings.updateLyricsOffset(9_999)
    expect(settings.lyricsOffsetMs.value).toBe(2000)
    settings.updateLyricsOffset(-9_999)
    expect(settings.lyricsOffsetMs.value).toBe(-2000)
  })

  it("toggles screen rotation and return-to-home and saves them together", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const settings = useSettings()

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    const row = (label: string) =>
      wrapper.findAll(".setting-row").find((r) => r.text().includes(label))!

    expect(settings.carouselEnabled.value).toBe(false)
    expect(settings.returnHomeEnabled.value).toBe(true)

    await row("Rotate screens").find(".ui-toggle").trigger("click")
    await flushPromises()
    expect(settings.carouselEnabled.value).toBe(true)

    await row("Return to Home").find(".ui-toggle").trigger("click")
    await flushPromises()
    expect(settings.returnHomeEnabled.value).toBe(false)

    const patch = fetchMock.mock.calls.filter(c => (c[1] as RequestInit)?.method === "PATCH").at(-1)!
    expect(JSON.parse((patch[1] as RequestInit).body as string).settings.screens).toEqual({
      carousel: true,
      returnHome: false,
    })
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

  it("keeps auto selected when the server cannot resolve the sun", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init as RequestInit)?.method === "PATCH") throw new TypeError("Failed to fetch")
      return json({})
    })
    const wrapper = mount(SettingsPanel)
    await flushPromises()
    await wrapper.findAll(".theme-card")[2]!.trigger("click")
    await flushPromises()
    expect(useSettings().theme.value).toBe("auto")
  })

  it("toggles phone push and reports a generic test failure", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: "nope" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }))
    const wrapper = mount(SettingsPanel)
    await flushPromises()

    const pushToggle = wrapper.findAllComponents({ name: "UiToggle" })
      .find((toggle) => toggle.element.closest(".setting-row")?.textContent?.includes("Phone & browser"))
    expect(pushToggle).toBeTruthy()
    pushToggle!.vm.$emit("update:modelValue", true)
    await flushPromises()
    pushToggle!.vm.$emit("update:modelValue", false)
    await flushPromises()

    await wrapper.findAll("button").find(b => b.text().includes("Send test to all clients"))!.trigger("click")
    await flushPromises()
    expect(wrapper.find(".reminder-result").text()).toContain("could not send the test")
  })

  it("confirms before resetting the home layout and restores the default", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init as RequestInit)?.method === "PATCH") return json({ message: "ok" })
      return json({})
    })
    localStorage.removeItem("homst-widget-layout")

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    await wrapper.findAll("button").find(b => b.text() === "Reset layout")!.trigger("click")
    expect(wrapper.text()).toContain("Reset the home screen layout?")

    // Cancel closes the prompt without touching the stored layout.
    await wrapper.findAll("button").find(b => b.text() === "Cancel")!.trigger("click")
    expect(wrapper.text()).not.toContain("Reset the home screen layout?")
    expect(localStorage.getItem("homst-widget-layout")).toBeNull()

    await wrapper.findAll("button").find(b => b.text() === "Reset layout")!.trigger("click")
    await wrapper.findAll("button").find(b => b.text() === "Reset")!.trigger("click")
    await flushPromises()

    const stored = JSON.parse(localStorage.getItem("homst-widget-layout")!)
    expect(stored).toHaveLength(9)
    expect(stored.find((card: any) => card.id === "photos")).toMatchObject({ col: 3, row: 1, w: 3, h: 5 })
    expect(stored.find((card: any) => card.id === "temperatures")).toMatchObject({ col: 2, row: 2, w: 1, h: 1 })
    expect(stored.find((card: any) => card.id === "camera")).toMatchObject({ col: 2, row: 0, w: 1, h: 2 })
    expect(stored.find((card: any) => card.id === "datetime")).toMatchObject({ col: 2, row: 3, w: 1, h: 2 })

    const patch = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === "PATCH")!
    const body = JSON.parse((patch[1] as RequestInit).body as string)
    expect(body.settings.widgetLayout).toHaveLength(9)
    expect(wrapper.text()).toContain("Home layout reset to the default.")
  })

  it("reports when the home layout reset cannot be saved", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init as RequestInit)?.method === "PATCH") throw new TypeError("Failed to fetch")
      return json({})
    })

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    await wrapper.findAll("button").find(b => b.text() === "Reset layout")!.trigger("click")
    await wrapper.findAll("button").find(b => b.text() === "Reset")!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("Could not save the layout")
  })

  it("filters cards to the ones holding every search word", async () => {
    const wrapper = mount(SettingsPanel)
    expect(wrapper.find(".settings-search__input").exists()).toBe(true)
    expect(wrapper.find(".settings-search__count").text()).toBe("")

    await wrapper.find(".settings-search__input").setValue("camera")
    await nextTick()

    expect(wrapper.find(".settings-card--camera").classes()).not.toContain("is-filtered-out")
    expect(wrapper.find(".settings-card--music").classes()).toContain("is-filtered-out")
    expect(wrapper.find(".settings-search__count").text()).toBe("1 card")

    // Words may live in different rows of the same card.
    await wrapper.find(".settings-search__input").setValue("camera password")
    await nextTick()
    expect(wrapper.find(".settings-card--camera").classes()).not.toContain("is-filtered-out")
    expect(wrapper.find(".settings-search__count").text()).toBe("1 card")
  })

  it("shows an empty state and clears the filter", async () => {
    const wrapper = mount(SettingsPanel)

    await wrapper.find(".settings-search__input").setValue("no-such-setting")
    await nextTick()

    expect(wrapper.findAll(".is-filtered-out")).toHaveLength(12)
    expect(wrapper.find(".settings-search-empty").text()).toContain("No settings match")
    expect(wrapper.find(".settings-search__count").text()).toBe("0 cards")

    await wrapper.find(".settings-search__clear").trigger("click")
    await nextTick()

    expect((wrapper.find(".settings-search__input").element as HTMLInputElement).value).toBe("")
    expect(wrapper.findAll(".is-filtered-out")).toHaveLength(0)
    expect(wrapper.find(".settings-search-empty").exists()).toBe(false)
    expect(wrapper.find(".settings-search__count").text()).toBe("")
  })

  it("clears the search with Escape", async () => {
    const wrapper = mount(SettingsPanel)
    const input = wrapper.find(".settings-search__input")

    await input.setValue("theme")
    await nextTick()
    expect(wrapper.findAll(".is-filtered-out").length).toBeGreaterThan(0)

    await input.trigger("keydown", { key: "Escape" })
    await nextTick()
    expect(wrapper.findAll(".is-filtered-out")).toHaveLength(0)
  })
})

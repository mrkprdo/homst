import { describe, it, expect, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import SettingsPanel from "@/components/settings/SettingsPanel.vue"
import { useSettings } from "@/composables/useSettings"
import { getAnimationEnabled } from "@/lib/motion"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

function toggles(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAllComponents({ name: "UiToggle" })
}

describe("SettingsPanel (notifications & motion)", () => {
  it("changing the text size updates the shared setting", async () => {
    const wrapper = mount(SettingsPanel)
    await flushPromises()
    const segmented = wrapper.findComponent({ name: "UiSegmentedControl" })
    const buttons = segmented.findAll(".segmented-btn")

    await buttons[1]!.trigger("click")
    const first = useSettings().fontSize.value
    await buttons[2]!.trigger("click")
    expect(useSettings().fontSize.value).not.toBe(first)
  })

  it("toggling the display channel persists notification settings", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(json({ message: "ok" }))

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    await toggles(wrapper)[1]!.trigger("click") // On this display
    await flushPromises()

    const patches = fetchMock.mock.calls.filter(c => (c[1] as RequestInit)?.method === "PATCH")
    expect(patches.length).toBeGreaterThanOrEqual(1)
    const lastBody = JSON.parse((patches[patches.length - 1]![1] as RequestInit).body as string)
    expect(lastBody.settings.notifications).toHaveProperty("hud")
    expect(lastBody.settings.notifications).not.toHaveProperty("email")
  })

  it("Send test to all clients posts a hud+push test and lists each result", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(json({}))
    fetchMock.mockResolvedValueOnce(json({}))
    fetchMock.mockResolvedValueOnce(json({ results: { hud: "sent to the display", push: "sent to 1 device(s)" } }))

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    await wrapper.findAll("button").find(b => b.text().includes("Send test to all clients"))!.trigger("click")
    await flushPromises()

    const post = fetchMock.mock.calls.find(c => String(c[0]).includes("/notifications/test"))
    expect(post).toBeTruthy()
    expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({ channels: ["hud", "push"] })
    expect(wrapper.findAll(".reminder-result")).toHaveLength(2)
    expect(wrapper.text()).toContain("sent to the display")
  })

  it("renders the phone push toggle", async () => {
    const wrapper = mount(SettingsPanel)
    await flushPromises()
    expect(wrapper.text()).toContain("Phone & browser")
    const buttons = wrapper.findAll("button").map(b => b.text())
    expect(buttons.some(t => t.includes("Send test to all clients"))).toBe(true)
  })

  it("the test button fires even when this device has no push subscription", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(json({}))
    fetchMock.mockResolvedValueOnce(json({}))
    fetchMock.mockResolvedValueOnce(json({ results: { hud: "sent to the display", push: "skipped: no devices have push turned on" } }))

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    const btn = wrapper.findAll("button").find(b => b.text().includes("Send test to all clients"))!
    expect(btn.attributes("disabled")).toBeUndefined()
    await btn.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("skipped: no devices have push turned on")
  })

  it("explains that the local server is unreachable instead of showing a failure", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(json({}))
    fetchMock.mockResolvedValueOnce(json({}))
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    await wrapper.findAll("button").find(b => b.text().includes("Send test to all clients"))!.trigger("click")
    await flushPromises()

    expect(wrapper.find(".reminder-result").exists()).toBe(false)
    expect(wrapper.find(".reminder-notice").text()).toContain("HOMST local server is out of reach")
    expect(wrapper.find(".reminder-notice").text()).toContain("outbound connection")
  })

  it("the motion toggle flips the runtime animation setting", async () => {
    const wrapper = mount(SettingsPanel)
    await flushPromises()
    expect(getAnimationEnabled()).toBe(true)

    await toggles(wrapper)[3]!.trigger("click") // Motion
    expect(getAnimationEnabled()).toBe(false)

    await toggles(wrapper)[3]!.trigger("click")
    expect(getAnimationEnabled()).toBe(true)
  })

  it("loads stored notification preferences on mount", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(json({}))
    fetchMock.mockResolvedValueOnce(json({
      notifications: { hud: false, defaultReminderMinutes: 60 },
    }))

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    const select = wrapper.find("select.reminder-default-select")
    expect((select.element as HTMLSelectElement).value).toBe("60")
  })
})

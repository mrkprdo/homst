import { describe, expect, it, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import SettingsPanel from "@/components/settings/SettingsPanel.vue"
import { useSettings } from "@/composables/useSettings"
import { householdApi } from "@/api/household"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const STORED = {
  ssid: "CedarNet",
  password: "secret",
  encryption: "WPA" as const,
  hidden: false,
}

function button(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll("button").find(b => b.text() === label)
}

describe("SettingsPanel — guest Wi-Fi", () => {
  it("pre-fills the network and saves the QR details", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init as RequestInit)?.method === "PATCH") {
        const body = JSON.parse((init as RequestInit).body as string)
        return json({ message: "ok", settings: { wifi: body.settings.wifi } })
      }
      return json({ wifi: STORED })
    })

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    const inputs = wrapper.findAll(".wifi-input")
    expect((inputs[0]!.element as HTMLInputElement).value).toBe("CedarNet")
    expect((inputs[1]!.element as HTMLInputElement).value).toBe("secret")
    expect(wrapper.find(".wifi-preview svg").exists()).toBe(true)
    expect(wrapper.text()).toContain("This is how it appears on the House card.")

    await inputs[0]!.setValue("  Cedar Guest  ")
    await inputs[1]!.setValue("new-secret")
    await wrapper.find(".wifi-security-select").setValue("WPA")
    const hiddenRow = wrapper.findAll(".setting-row").find(r => r.text().includes("Hidden network"))!
    await hiddenRow.find(".ui-toggle").trigger("click")
    await button(wrapper, "Save Wi-Fi")!.trigger("click")
    await flushPromises()

    const patch = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === "PATCH")!
    expect(JSON.parse((patch[1] as RequestInit).body as string).settings.wifi).toEqual({
      ssid: "Cedar Guest",
      password: "new-secret",
      encryption: "WPA",
      hidden: true,
    })
    expect(wrapper.text()).toContain("Wi-Fi saved.")
    expect(useSettings().wifiSsid.value).toBe("Cedar Guest")
    expect(useSettings().wifiPassword.value).toBe("new-secret")

    // A change streamed from another screen mirrors into the form.
    useSettings().applyWifiSettings({ ssid: "OtherNet", password: "pw2", encryption: "WEP", hidden: true })
    await flushPromises()
    expect((wrapper.findAll(".wifi-input")[0]!.element as HTMLInputElement).value).toBe("OtherNet")
    expect((wrapper.find(".wifi-security-select").element as HTMLSelectElement).value).toBe("WEP")
    wrapper.unmount()
  })

  it("hides the preview until a network name is entered and removes it", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init as RequestInit)?.method === "PATCH") {
        return json({ message: "ok", settings: { wifi: null } })
      }
      return json({ wifi: STORED })
    })

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    await wrapper.findAll(".wifi-input")[0]!.setValue("")
    expect(wrapper.find(".wifi-preview").exists()).toBe(false)

    await wrapper.findAll(".wifi-input")[0]!.setValue(STORED.ssid)
    expect(wrapper.find(".wifi-preview").exists()).toBe(true)

    await button(wrapper, "Remove")!.trigger("click")
    await flushPromises()

    const patch = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === "PATCH")!
    expect(JSON.parse((patch[1] as RequestInit).body as string).settings.wifi).toEqual({
      ssid: "",
      password: "",
      encryption: "WPA",
      hidden: false,
    })
    expect(wrapper.text()).toContain("Wi-Fi removed.")
    expect(useSettings().wifiSsid.value).toBe("")
    wrapper.unmount()
  })

  it("keeps the local form when the save response has no settings payload", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init as RequestInit)?.method === "PATCH") return json({ message: "ok" })
      return json({})
    })

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    await wrapper.findAll(".wifi-input")[0]!.setValue("FallbackNet")
    await wrapper.findAll(".wifi-input")[1]!.setValue("pw")
    await button(wrapper, "Save Wi-Fi")!.trigger("click")
    await flushPromises()

    expect(useSettings().wifiSsid.value).toBe("FallbackNet")
    expect(useSettings().wifiPassword.value).toBe("pw")
    wrapper.unmount()
  })

  it("omits the password for an open network and reports save failures", async () => {    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init as RequestInit)?.method === "PATCH") {
        const body = JSON.parse((init as RequestInit).body as string)
        return json({ message: "ok", settings: { wifi: body.settings.wifi } })
      }
      return json({ wifi: STORED })
    })

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    await wrapper.find(".wifi-security-select").setValue("nopass")
    expect(wrapper.findAll(".wifi-input")).toHaveLength(1)
    await button(wrapper, "Save Wi-Fi")!.trigger("click")
    await flushPromises()

    const patch = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === "PATCH")!
    expect(JSON.parse((patch[1] as RequestInit).body as string).settings.wifi).toEqual({
      ssid: "CedarNet",
      password: "",
      encryption: "nopass",
      hidden: false,
    })
    wrapper.unmount()

    vi.spyOn(householdApi, "updateSettings").mockRejectedValueOnce("nope")
    const failing = mount(SettingsPanel)
    await flushPromises()
    await button(failing, "Save Wi-Fi")!.trigger("click")
    await flushPromises()
    expect(failing.find(".reset-error").text()).toBe("Could not save the Wi-Fi details.")
    failing.unmount()
  })
})

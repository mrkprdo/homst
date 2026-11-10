import { beforeEach, describe, expect, it, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import NestSettingsCard from "@/components/settings/NestSettingsCard.vue"
import { nestApi, type NestTemperatures } from "@/api/nest"
import { useNest } from "@/composables/useNest"

function status(overrides: Partial<NestTemperatures> = {}): NestTemperatures {
  return {
    configured: true,
    authType: "google",
    connected: true,
    rooms: [{
      id: "device.1",
      name: "Living Room",
      room: "Living Room",
      temperatureC: 21,
      humidity: 40,
      kind: "thermostat",
      online: true,
      active: false,
    }],
    updatedAt: "2026-01-01T00:00:00Z",
    error: null,
    ...overrides,
  }
}

function seed(value: NestTemperatures) {
  useNest().applyStatus(value)
}

describe("NestSettingsCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("shows the disconnected state and saves Google credentials", async () => {
    seed(status({ configured: false, connected: false, rooms: [], authType: null }))
    const save = vi.spyOn(nestApi, "saveCredentials").mockResolvedValueOnce(status())

    const wrapper = mount(NestSettingsCard)
    expect(wrapper.find(".nest-status").text()).toBe("Not connected yet.")

    const fields = wrapper.findAll("textarea")
    await fields[0]!.setValue("https://accounts.google.com/o/oauth2/iframerpc?action=issueToken")
    await fields[1]!.setValue("SID=abc")
    await wrapper.find(".nest-actions button").trigger("click")
    await flushPromises()

    expect(save).toHaveBeenCalledWith({
      account_type: "google",
      issue_token: "https://accounts.google.com/o/oauth2/iframerpc?action=issueToken",
      cookies: "SID=abc",
    })
    expect(wrapper.find(".nest-status").text()).toBe("Connected — 1 room")
    expect(wrapper.find(".nest-message").text()).toContain("Nest connected")
    expect((fields[0]!.element as HTMLTextAreaElement).value).toBe("")
    expect((fields[1]!.element as HTMLTextAreaElement).value).toBe("")
    wrapper.unmount()
  })

  it("checks the connection on demand", async () => {
    const get = vi.spyOn(nestApi, "getTemperatures").mockResolvedValueOnce(status({
      configured: false,
      connected: false,
      rooms: [],
      authType: null,
    }))

    const wrapper = mount(NestSettingsCard)
    expect(wrapper.find(".nest-status").text()).toBe("Not checked yet.")

    await wrapper.findAll(".nest-actions button")[1]!.trigger("click")
    await flushPromises()

    expect(get).toHaveBeenCalled()
    expect(wrapper.find(".nest-status").text()).toBe("Not connected yet.")
    wrapper.unmount()
  })

  it("saves legacy Nest credentials after switching account type", async () => {
    seed(status({ configured: false, connected: false, rooms: [], authType: null }))
    const save = vi.spyOn(nestApi, "saveCredentials").mockResolvedValueOnce(
      status({ authType: "nest" }),
    )

    const wrapper = mount(NestSettingsCard)
    await wrapper.find(".nest-select").setValue("nest")
    await wrapper.find(".nest-input").setValue("legacy-token")
    await wrapper.find(".nest-actions button").trigger("click")
    await flushPromises()

    expect(save).toHaveBeenCalledWith({
      account_type: "nest",
      access_token: "legacy-token",
    })
    wrapper.unmount()
  })

  it("keeps credentials when Nest rejects them", async () => {
    seed(status({ configured: false, connected: false, rooms: [], authType: null }))
    vi.spyOn(nestApi, "saveCredentials").mockResolvedValueOnce(
      status({ connected: false, error: "Cookies expired." }),
    )

    const wrapper = mount(NestSettingsCard)
    await wrapper.find(".nest-actions button").trigger("click")
    await flushPromises()

    expect(wrapper.find(".nest-error").text()).toBe("Cookies expired.")
    expect(wrapper.find(".nest-status").text()).toBe("Cookies expired.")
    wrapper.unmount()
  })

  it("reports a thrown save failure", async () => {
    seed(status({ configured: false, connected: false, rooms: [], authType: null }))
    vi.spyOn(nestApi, "saveCredentials").mockRejectedValueOnce(new Error("Network down"))

    const wrapper = mount(NestSettingsCard)
    await wrapper.find(".nest-actions button").trigger("click")
    await flushPromises()

    expect(wrapper.find(".nest-error").text()).toBe("Network down")
    wrapper.unmount()
  })

  it("reports a non-Error save failure", async () => {
    seed(status({ configured: false, connected: false, rooms: [], authType: null }))
    vi.spyOn(nestApi, "saveCredentials").mockRejectedValueOnce("nope")

    const wrapper = mount(NestSettingsCard)
    await wrapper.find(".nest-actions button").trigger("click")
    await flushPromises()

    expect(wrapper.find(".nest-error").text()).toBe("Could not save the Nest credentials.")
    wrapper.unmount()
  })

  it("disconnects a configured account", async () => {
    seed(status())
    const get = vi.spyOn(nestApi, "getTemperatures").mockResolvedValueOnce(
      status({ configured: false, connected: false, rooms: [], authType: null }),
    )
    const clear = vi.spyOn(nestApi, "clearCredentials").mockResolvedValueOnce({
      message: "Nest disconnected",
    })

    const wrapper = mount(NestSettingsCard)
    expect(wrapper.find(".nest-status").text()).toBe("Connected — 1 room")

    await wrapper.findAll(".nest-actions button")[1]!.trigger("click")
    await flushPromises()

    expect(clear).toHaveBeenCalled()
    expect(get).toHaveBeenCalledWith(true)
    expect(wrapper.find(".nest-message").text()).toBe("Nest disconnected.")
    expect(wrapper.find(".nest-status").text()).toBe("Not connected yet.")
    wrapper.unmount()
  })

  it("reports disconnect failures", async () => {
    seed(status())
    vi.spyOn(nestApi, "clearCredentials").mockRejectedValueOnce(new Error("Cannot disconnect"))

    const wrapper = mount(NestSettingsCard)
    await wrapper.findAll(".nest-actions button")[1]!.trigger("click")
    await flushPromises()

    expect(wrapper.find(".nest-error").text()).toBe("Cannot disconnect")
    wrapper.unmount()
  })

  it("shows an error state from the status response and preselects the account", async () => {
    seed(status({ authType: "nest", connected: false, error: "Sign in again." }))

    const wrapper = mount(NestSettingsCard)

    expect(wrapper.find(".nest-status").classes()).toContain("nest-status--error")
    expect(wrapper.find(".nest-status").text()).toBe("Sign in again.")
    expect((wrapper.find(".nest-select").element as HTMLSelectElement).value).toBe("nest")
    wrapper.unmount()
  })

  it("reports a disconnect failure that is not an Error", async () => {
    seed(status())
    vi.spyOn(nestApi, "clearCredentials").mockRejectedValueOnce("nope")

    const wrapper = mount(NestSettingsCard)
    await wrapper.findAll(".nest-actions button")[1]!.trigger("click")
    await flushPromises()

    expect(wrapper.find(".nest-error").text()).toBe("Could not disconnect Nest.")
    wrapper.unmount()
  })
})

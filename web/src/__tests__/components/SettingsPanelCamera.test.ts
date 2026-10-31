import { describe, it, expect, vi } from "vitest"
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
  url: "rtsp://192.168.1.20:554/stream1",
  username: "admin",
  passwordSet: true,
  rotation: 90,
  streamPath: "/api/v1/camera/hls/0123456789abcdef/index.m3u8",
}

function button(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll("button").find(b => b.text() === label)
}

describe("SettingsPanel — camera", () => {
  it("pre-fills the stored camera and saves credentials", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init as RequestInit)?.method === "PATCH") {
        return json({
          message: "ok",
          settings: {
            camera: {
              url: "rtsp://192.168.1.30:554/new",
              username: "viewer",
              passwordSet: true,
              streamPath: "/api/v1/camera/hls/abcdef0123456789/index.m3u8",
            },
          },
        })
      }
      return json({ camera: STORED })
    })

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    const inputs = wrapper.findAll(".camera-input")
    expect((inputs[0]!.element as HTMLInputElement).value).toBe(STORED.url)
    expect((inputs[1]!.element as HTMLInputElement).value).toBe("admin")
    expect(wrapper.text()).toContain("A password is saved. Leave blank to keep it.")
    expect((wrapper.find(".camera-rotation-select").element as HTMLSelectElement).value).toBe("90")

    await inputs[0]!.setValue("rtsp://192.168.1.30:554/new")
    await inputs[1]!.setValue("viewer")
    await inputs[2]!.setValue("hunter2")
    await wrapper.find(".camera-rotation-select").setValue("270")
    await button(wrapper, "Save camera")!.trigger("click")
    await flushPromises()

    const patch = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === "PATCH")!
    const body = JSON.parse((patch[1] as RequestInit).body as string)
    expect(body.settings.camera).toEqual({
      url: "rtsp://192.168.1.30:554/new",
      username: "viewer",
      rotation: 270,
      password: "hunter2",
    })
    expect(wrapper.text()).toContain("Camera saved.")
    expect((inputs[2]!.element as HTMLInputElement).value).toBe("")
    expect(useSettings().cameraPasswordSet.value).toBe(true)
    wrapper.unmount()
  })

  it("keeps the stored password when the field is left blank", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init as RequestInit)?.method === "PATCH") {
        return json({ message: "ok", settings: { camera: STORED } })
      }
      return json({ camera: STORED })
    })

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    await button(wrapper, "Save camera")!.trigger("click")
    await flushPromises()

    const patch = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === "PATCH")!
    const body = JSON.parse((patch[1] as RequestInit).body as string)
    expect(body.settings.camera).not.toHaveProperty("password")
    wrapper.unmount()
  })

  it("removes the camera and reports a save error", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init as RequestInit)?.method === "PATCH") {
        return json({ message: "ok", settings: { camera: null } })
      }
      return json({ camera: STORED })
    })

    const wrapper = mount(SettingsPanel)
    await flushPromises()

    await button(wrapper, "Remove")!.trigger("click")
    await flushPromises()

    const patch = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === "PATCH")!
    const body = JSON.parse((patch[1] as RequestInit).body as string)
    expect(body.settings.camera).toEqual({ url: "", username: "", rotation: 0 })
    expect(wrapper.text()).toContain("Camera removed.")
    wrapper.unmount()

    fetchMock.mockImplementation(async (_url, init) => {
      if ((init as RequestInit)?.method === "PATCH") {
        return json({ detail: "Camera URL is not valid." }, 422)
      }
      return json({ camera: STORED })
    })
    const failing = mount(SettingsPanel)
    await flushPromises()
    await button(failing, "Save camera")!.trigger("click")
    await flushPromises()
    expect(failing.find(".reset-error").text()).toBe("Camera URL is not valid.")
    failing.unmount()
  })

  it("falls back to a generic message for non-Error failures", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async () => json({ camera: STORED }))
    vi.spyOn(householdApi, "updateSettings").mockRejectedValueOnce("nope")

    const wrapper = mount(SettingsPanel)
    await flushPromises()
    await button(wrapper, "Save camera")!.trigger("click")
    await flushPromises()
    expect(wrapper.find(".reset-error").text()).toBe("Could not save the camera.")
    wrapper.unmount()
  })
})

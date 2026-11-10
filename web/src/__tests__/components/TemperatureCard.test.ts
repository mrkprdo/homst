import { beforeEach, describe, expect, it, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import TemperatureCard from "@/components/home/TemperatureCard.vue"
import { nestApi, type NestTemperatures } from "@/api/nest"
import { useUi } from "@/composables/useUi"

function status(overrides: Partial<NestTemperatures> = {}): NestTemperatures {
  return {
    configured: true,
    authType: "nest",
    connected: true,
    rooms: [],
    updatedAt: "2026-01-01T00:00:00Z",
    error: null,
    ...overrides,
  }
}

const ROOMS = [
  {
    id: "device.1",
    name: "Living Room",
    room: "Living Room",
    temperatureC: 21.5,
    humidity: 44,
    kind: "thermostat" as const,
    online: true,
    active: false,
  },
  {
    id: "kryptonite.1",
    name: "Basement",
    room: "Basement",
    temperatureC: 19.55,
    humidity: null,
    kind: "sensor" as const,
    online: true,
    active: true,
  },
  {
    id: "kryptonite.2",
    name: "Guest Sensor",
    room: "Guest Room",
    temperatureC: 20,
    humidity: null,
    kind: "sensor" as const,
    online: true,
    active: false,
  },
  {
    id: "kryptonite.3",
    name: "Kids Room",
    room: null,
    temperatureC: 18,
    humidity: null,
    kind: "sensor" as const,
    online: false,
    active: false,
  },
]

describe("TemperatureCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("prompts for setup and opens Settings", async () => {
    vi.spyOn(nestApi, "getTemperatures").mockResolvedValue(status({
      configured: false,
      connected: false,
    }))

    const wrapper = mount(TemperatureCard)
    await flushPromises()

    expect(wrapper.text()).toContain("Connect Nest")
    await wrapper.find(".temperature-link").trigger("click")
    expect(useUi().activePanel.value).toBe("settings")
    wrapper.unmount()
  })

  it("lists every room with humidity, active state, average and offline state", async () => {
    vi.spyOn(nestApi, "getTemperatures").mockResolvedValue(status({ rooms: ROOMS }))

    const wrapper = mount(TemperatureCard)
    await flushPromises()

    expect(wrapper.find(".temperature-average").text()).toBe("19.8°")
    expect(wrapper.find(".hero-number").text()).toBe("19.8")
    expect(wrapper.findAll(".hero-dot")).toHaveLength(4)
    expect(wrapper.find(".hero-extremes").text()).toContain("Kids Room")
    expect(wrapper.find(".hero-extremes").text()).toContain("Living Room")

    const rows = wrapper.findAll(".room-tile")
    expect(rows).toHaveLength(4)
    expect(rows[0]!.text()).toContain("Living Room")
    expect(rows[0]!.text()).toContain("44%")
    expect(rows[0]!.text()).toContain("21.5°")
    expect(rows[0]!.text()).toContain("Thermostat")
    expect(rows[1]!.text()).toContain("19.6°")
    expect(rows[1]!.find(".room-badge--active").text()).toBe("Active")
    expect(rows[2]!.text()).toContain("Guest Room")
    expect(rows[2]!.text()).toContain("20°")
    expect(rows[2]!.text()).toContain("vs avg")
    expect(rows[3]!.text()).toContain("Kids Room")
    expect(rows[3]!.find(".room-badge--offline").text()).toBe("Offline")
    expect(rows[3]!.classes()).toContain("room-tile--offline")
    expect(rows[2]!.attributes("title")).toContain("Guest Sensor")
    expect(rows[0]!.attributes("style")).toContain("--tint")
    wrapper.unmount()
  })

  it("shows a credential error with a Settings shortcut", async () => {
    vi.spyOn(nestApi, "getTemperatures").mockResolvedValue(status({
      connected: false,
      error: "Nest sign-in expired.",
    }))

    const wrapper = mount(TemperatureCard)
    await flushPromises()

    expect(wrapper.text()).toContain("Nest unavailable")
    expect(wrapper.text()).toContain("Nest sign-in expired.")
    await wrapper.find(".temperature-link").trigger("click")
    expect(useUi().activePanel.value).toBe("settings")
    wrapper.unmount()
  })

  it("keeps showing stale rooms while Nest is offline", async () => {
    vi.spyOn(nestApi, "getTemperatures").mockResolvedValue(status({
      connected: false,
      rooms: ROOMS,
      error: "Could not reach Nest.",
    }))

    const wrapper = mount(TemperatureCard)
    await flushPromises()

    expect(wrapper.find(".temperature-note").text()).toBe("Could not reach Nest.")
    expect(wrapper.findAll(".room-tile")).toHaveLength(4)
    wrapper.unmount()
  })

  it("handles an empty but configured setup", async () => {
    vi.spyOn(nestApi, "getTemperatures").mockResolvedValue(status({ rooms: [] }))

    const wrapper = mount(TemperatureCard)
    await flushPromises()

    expect(wrapper.text()).toContain("No temperature sensors found.")
    wrapper.unmount()
  })

  it("shows the loading state before the first response", async () => {
    let resolve!: (value: NestTemperatures) => void
    vi.spyOn(nestApi, "getTemperatures").mockReturnValueOnce(
      new Promise<NestTemperatures>((done) => { resolve = done }),
    )

    const wrapper = mount(TemperatureCard)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain("Reading temperatures…")

    resolve(status({ rooms: ROOMS }))
    await flushPromises()
    expect(wrapper.findAll(".room-tile")).toHaveLength(4)
    wrapper.unmount()
  })

  it("reports a server failure before any status arrives", async () => {
    vi.spyOn(nestApi, "getTemperatures").mockRejectedValueOnce(new Error("Server unreachable"))

    const wrapper = mount(TemperatureCard)
    await flushPromises()

    expect(wrapper.text()).toContain("Indoor temperatures unavailable")
    expect(wrapper.text()).toContain("Server unreachable")
    wrapper.unmount()
  })
})

import { describe, expect, it } from "vitest"
import { mount } from "@vue/test-utils"
import WifiQr from "@/components/home/WifiQr.vue"

describe("WifiQr", () => {
  it("paints the encoded matrix as one crisp SVG path", () => {
    const wrapper = mount(WifiQr, {
      props: { payload: "WIFI:T:WPA;S:Cedar;P:secret;;", label: "Join Cedar Wi-Fi" },
    })

    const svg = wrapper.find("svg.wifi-qr")
    expect(svg.attributes("role")).toBe("img")
    expect(svg.attributes("aria-label")).toBe("Join Cedar Wi-Fi")
    expect(svg.attributes("viewBox")).toMatch(/^0 0 \d+ \d+$/)

    const paper = svg.find("rect.wifi-qr__paper")
    expect(paper.exists()).toBe(true)
    expect(Number(paper.attributes("rx"))).toBeGreaterThan(0)

    const modules = svg.find("path.wifi-qr__modules")
    expect(modules.attributes("d")!.length).toBeGreaterThan(100)
    expect(paper.attributes("fill")).toBeUndefined()
    expect(modules.attributes("fill")).toBeUndefined()

    const fallback = mount(WifiQr, { props: { payload: "hello" } })
    expect(fallback.find("svg").attributes("aria-label")).toBe("Wi-Fi QR code")
  })

  it("renders nothing when the payload is too large for a QR code", () => {
    const wrapper = mount(WifiQr, { props: { payload: "x".repeat(5_000) } })
    expect(wrapper.find("svg").exists()).toBe(false)
  })
})

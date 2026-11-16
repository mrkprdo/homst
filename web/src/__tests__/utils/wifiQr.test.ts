import { describe, expect, it } from "vitest"
import { wifiQrPayload } from "@/lib/wifiQr"

describe("wifiQrPayload", () => {
  it("builds a WPA payload with an escaped network name and password", () => {
    expect(wifiQrPayload({ ssid: "Cedar;House", password: "p:a,ss\\word" })).toBe(
      "WIFI:T:WPA;S:Cedar\\;House;P:p\\:a\\,ss\\\\word;;",
    )
  })

  it("marks hidden networks and omits the password for an open one", () => {
    expect(wifiQrPayload({ ssid: "  Guest  ", encryption: "nopass", hidden: true })).toBe(
      "WIFI:T:nopass;S:Guest;H:true;;",
    )
  })

  it("returns nothing to encode when no network name is set", () => {
    expect(wifiQrPayload({ ssid: "   ", password: "secret" })).toBe("")
  })
})

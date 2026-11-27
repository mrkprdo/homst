import type { WifiEncryption } from "@/api/household"

export interface WifiQrConfig {
  ssid: string
  password?: string
  encryption?: WifiEncryption
  hidden?: boolean
}

function escapeField(value: string): string {
  return value.replace(/[\\;,:"]/g, "\\$&")
}

export function wifiQrPayload({ ssid, password = "", encryption = "WPA", hidden = false }: WifiQrConfig): string {
  const network = ssid.trim()
  if (!network) return ""

  let payload = `WIFI:T:${encryption};S:${escapeField(network)};`
  if (encryption !== "nopass") payload += `P:${escapeField(password)};`
  if (hidden) payload += "H:true;"
  return `${payload};`
}

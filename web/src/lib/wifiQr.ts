import type { WifiEncryption } from "@/api/household"

export interface WifiQrConfig {
  ssid: string
  password?: string
  encryption?: WifiEncryption
  hidden?: boolean
}

/**
 * Escape the characters the Wi-Fi QR format reserves. Without this, a network
 * name like "Home;Guest" would split the payload at the wrong field.
 */
function escapeField(value: string): string {
  return value.replace(/[\\;,:"]/g, "\\$&")
}

/**
 * Build the standard `WIFI:` payload scanned by phones. An empty SSID means
 * there is nothing to join: return an empty string so callers can hide the QR.
 */
export function wifiQrPayload({ ssid, password = "", encryption = "WPA", hidden = false }: WifiQrConfig): string {
  const network = ssid.trim()
  if (!network) return ""

  let payload = `WIFI:T:${encryption};S:${escapeField(network)};`
  // Open networks must omit the password field entirely.
  if (encryption !== "nopass") payload += `P:${escapeField(password)};`
  if (hidden) payload += "H:true;"
  return `${payload};`
}

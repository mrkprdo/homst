import { nextTick, ref } from "vue"
import { householdApi } from "@/api/household"
import type { CameraSettings, HouseholdSettings, WidgetDef, WifiEncryption, WifiSettings } from "@/api/household"
import { photosApi } from "@/api/photos"
import { HOME_LAYOUT_EVENT } from "@/lib/homeLayout"

export type Theme = "light" | "dark" | "system" | "auto"
export type ThemePreset = "default" | "futur"
export type AccentColor =
  | "peach" | "sage" | "mauve" | "plum" | "sky"
  | "mint" | "honey" | "violet" | "clay" | "aqua"
export type FontSize = "small" | "medium" | "large" | "xlarge"

export interface PhotoEntry {
  id: string
  url: string
  selected: boolean
  created_at?: string
}

export interface AccentPaletteEntry {
  base: string
  light: string
  lighter: string
  dark: string
  darker: string
  onAccent: string
}

export const accentPalette: Record<AccentColor, AccentPaletteEntry> = {
  peach:  { base: "#fcd0a1", light: "#fde0c6", lighter: "#feeedb", dark: "#caa681", darker: "#977c61", onAccent: "#1c2828" },
  sage:   { base: "#b1b695", light: "#c5c8af", lighter: "#d8dac9", dark: "#8e9277", darker: "#6a6e59", onAccent: "#1c2828" },
  mauve:  { base: "#a690a4", light: "#c4b7c3", lighter: "#e2dde2", dark: "#857383", darker: "#645663", onAccent: "#1c2828" },
  plum:   { base: "#5e4b56", light: "#92818b", lighter: "#c5bcc1", dark: "#4b3c45", darker: "#382d34", onAccent: "#fafafa" },
  sky:    { base: "#afd2e9", light: "#c3deef", lighter: "#d7eaf4", dark: "#8ca8ba", darker: "#697e8c", onAccent: "#1c2828" },
  mint:   { base: "#8ae3c6", light: "#b5f3df", lighter: "#d6f8ec", dark: "#4fb99c", darker: "#16756b", onAccent: "#15171c" },
  honey:  { base: "#e0a21a", light: "#f2c64b", lighter: "#fce3a0", dark: "#b27a0b", darker: "#8a6206", onAccent: "#15171c" },
  violet: { base: "#6b5aa0", light: "#a99bd2", lighter: "#cfc7e7", dark: "#52447f", darker: "#3b305e", onAccent: "#fffdf4" },
  clay:   { base: "#c96a12", light: "#e08a2a", lighter: "#f5c98f", dark: "#9e4e08", darker: "#7a3b05", onAccent: "#15171c" },
  aqua:   { base: "#67d5e0", light: "#9ae7ef", lighter: "#c9f5f8", dark: "#2a9fac", darker: "#17666f", onAccent: "#15171c" },
}

export const accentSets: Record<ThemePreset, AccentColor[]> = {
  default: ["peach", "sage", "mauve", "plum", "sky"],
  futur:   ["mint", "honey", "violet", "clay", "aqua"],
}

export const presetDefaultAccent: Record<ThemePreset, AccentColor> = {
  default: "sage",
  futur: "mint",
}

export const defaultAccentColors: AccentColor[] = ["peach", "sage", "mauve", "plum", "sky"]

export const fontSizeScale: Record<FontSize, Record<string, string>> = {
  small:  { display: "22px", title: "16px", heading: "13px", body: "11px", label: "10px", micro:  "8px" },
  medium: { display: "28px", title: "20px", heading: "16px", body: "14px", label: "12px", micro: "10px" },
  large:  { display: "35px", title: "25px", heading: "20px", body: "18px", label: "15px", micro: "12px" },
  xlarge: { display: "44px", title: "31px", heading: "25px", body: "22px", label: "19px", micro: "15px" },
}

const theme = ref<Theme>("system")
const themePreset = ref<ThemePreset>("futur")
const accentColor = ref<AccentColor>("mint")
const fontSize = ref<FontSize>("large")
const warm = ref(false)
const autoThemeDark = ref<boolean | null>(null)
const autoSunrise = ref<string | null>(null)
const autoSunset = ref<string | null>(null)
const hudEnabled = ref(true)
const lyricsEnabled = ref(true)
const lyricsOffsetMs = ref(0)
const musicBackground = ref(true)
const musicBackgroundSpin = ref(false)
const musicCardSpin = ref(true)
const carouselEnabled = ref(false)
const returnHomeEnabled = ref(true)
const navAutoHide = ref(false)
const autoRefreshEnabled = ref(false)
const autoRefreshMinutes = ref(60)
const houseName = ref("")
const widgetLayout = ref<WidgetDef[]>([])
const address = ref("")
const holidayCountry = ref("")
const holidayProvince = ref("")
const lat = ref<number | null>(null)
const lon = ref<number | null>(null)
const photos = ref<PhotoEntry[]>([])
const cameraUrl = ref("")
const cameraUsername = ref("")
const cameraPasswordSet = ref(false)
const cameraRotation = ref(0)
const cameraStreamPath = ref<string | null>(null)
const wifiSsid = ref("")
const wifiPassword = ref("")
const wifiEncryption = ref<WifiEncryption>("WPA")
const wifiHidden = ref(false)
const defaultReminderMinutes = ref<number | null>(null)
const accentMemory: Record<ThemePreset, AccentColor> = { ...presetDefaultAccent }

function applyThemePresetToDOM(preset: ThemePreset) {
  if (typeof document === "undefined") return
  document.documentElement.classList.toggle("futur", preset === "futur")
}

function applyAccentToDOM(color: AccentColor) {
  const p = accentPalette[color]
  const root = document.documentElement
  root.style.setProperty("--color-accent-base", p.base)
  root.style.setProperty("--color-accent-light", p.light)
  root.style.setProperty("--color-accent-lighter", p.lighter)
  root.style.setProperty("--color-accent-dark", p.dark)
  root.style.setProperty("--color-accent-darker", p.darker)
  root.style.setProperty("--color-accent-glow", p.lighter)
  root.style.setProperty("--color-on-accent", p.onAccent)
  const darkHover = p.onAccent === "#fffdf4" || p.onAccent === "#fafafa"
  root.style.setProperty("--color-actionHover", darkHover ? p.dark : p.light)
  if (themePreset.value === "futur") {
    root.style.setProperty("--shadow-accent-lip", "var(--color-outline)")
    root.style.setProperty("--shadow-accent-drop", "transparent")
    root.style.setProperty("--shadow-accent-inner", "transparent")
    return
  }
  const isDark = document.documentElement.classList.contains("dark")
  const s = p.dark
  const r = parseInt(s.slice(1, 3), 16)
  const g = parseInt(s.slice(3, 5), 16)
  const b = parseInt(s.slice(5, 7), 16)
  const a  = isDark ? 0.30 : 0.42
  const da = isDark ? 0.18 : 0.28
  const ia = isDark ? 0.12 : 0.14
  root.style.setProperty("--shadow-accent-lip",   `rgba(${r},${g},${b},${a})`)
  root.style.setProperty("--shadow-accent-drop",  `rgba(${r},${g},${b},${da})`)
  root.style.setProperty("--shadow-accent-inner", `rgba(${r},${g},${b},${ia})`)
}

function applyFontSizeToDOM(size: FontSize) {
  const s = fontSizeScale[size]
  const root = document.documentElement
  root.style.setProperty("--text-display-size", s.display)
  root.style.setProperty("--text-title-size",   s.title)
  root.style.setProperty("--text-heading-size", s.heading)
  root.style.setProperty("--text-body-size",    s.body)
  root.style.setProperty("--text-label-size",   s.label)
  root.style.setProperty("--text-micro-size",   s.micro)
}

function updateTheme(t: Theme) {
  theme.value = t
  if (t !== "auto") {
    autoThemeDark.value = null
    autoSunrise.value = null
    autoSunset.value = null
  }
  applyAccentToDOM(accentColor.value)
}

function updateThemePreset(preset: ThemePreset) {
  themePreset.value = preset
  applyThemePresetToDOM(preset)
  if (!accentSets[preset].includes(accentColor.value)) {
    const remembered = accentMemory[preset]
    accentColor.value = accentSets[preset].includes(remembered)
      ? remembered
      : presetDefaultAccent[preset]
  }
  applyAccentToDOM(accentColor.value)
}

function updateAccentColor(color: AccentColor) {
  if (!(color in accentPalette)) return
  accentColor.value = color
  if (accentSets[themePreset.value].includes(color)) {
    accentMemory[themePreset.value] = color
  }
  applyAccentToDOM(color)
}

function updateFontSize(size: FontSize) {
  fontSize.value = size
  applyFontSizeToDOM(size)
}

function updateWarm(on: boolean) {
  warm.value = on
}

function updateHudEnabled(on: boolean) {
  hudEnabled.value = on
}

function updateLyricsEnabled(on: boolean) {
  lyricsEnabled.value = on
}

function updateLyricsOffset(ms: number) {
  const value = Number.isFinite(ms) ? ms : 0
  lyricsOffsetMs.value = Math.round(Math.max(-2000, Math.min(2000, value)) / 50) * 50
}

function updateMusicBackground(on: boolean) {
  musicBackground.value = on
}

function updateMusicBackgroundSpin(on: boolean) {
  musicBackgroundSpin.value = on
}

function updateMusicCardSpin(on: boolean) {
  musicCardSpin.value = on
}

function updateCarouselEnabled(on: boolean) {
  carouselEnabled.value = on
}

function updateReturnHomeEnabled(on: boolean) {
  returnHomeEnabled.value = on
}

function updateNavAutoHide(on: boolean) {
  navAutoHide.value = on
}

function updateAutoRefreshEnabled(on: boolean) {
  autoRefreshEnabled.value = on
}

function updateAutoRefreshMinutes(minutes: number) {
  const value = Number.isFinite(minutes) ? Math.round(minutes) : 60
  autoRefreshMinutes.value = Math.min(1440, Math.max(15, value))
}

function updateHouseName(name: string) {
  houseName.value = name
}

function updateWidgetLayout(layout: WidgetDef[]) {
  widgetLayout.value = layout
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(HOME_LAYOUT_EVENT, { detail: layout }))
  }
}

function applyCameraSettings(camera: CameraSettings | null) {
  cameraUrl.value = camera?.url ?? ""
  cameraUsername.value = camera?.username ?? ""
  cameraPasswordSet.value = camera?.passwordSet === true
  cameraRotation.value = camera?.rotation ?? 0
  cameraStreamPath.value = camera?.streamPath ?? null
}

function applyWifiSettings(wifi: WifiSettings | null | undefined) {
  wifiSsid.value = wifi?.ssid ?? ""
  wifiPassword.value = wifi?.password ?? ""
  wifiEncryption.value = wifi?.encryption ?? "WPA"
  wifiHidden.value = wifi?.hidden === true
}

function updateDefaultReminderMinutes(minutes: number | null) {
  defaultReminderMinutes.value = minutes
}

let serverApplyDepth = 0

export function isApplyingRemoteSettings(): boolean {
  return serverApplyDepth > 0
}

export function applyHouseholdSettings(s: HouseholdSettings) {
  serverApplyDepth++
  try {
    if (s.themePreset === "default" || s.themePreset === "futur") {
      updateThemePreset(s.themePreset)
    }
    if (s.theme) updateTheme(s.theme as Theme)
    if (s.accentColor) updateAccentColor(s.accentColor as AccentColor)
    if (s.fontSize) updateFontSize(s.fontSize as FontSize)
    if (s.warm !== undefined) updateWarm(!!s.warm)
    if (s.autoThemeDark !== undefined) autoThemeDark.value = s.autoThemeDark ?? null
    if (s.autoSunrise !== undefined) autoSunrise.value = s.autoSunrise ?? null
    if (s.autoSunset !== undefined) autoSunset.value = s.autoSunset ?? null
    if (s.houseName !== undefined) updateHouseName(s.houseName)
    if (s.address !== undefined) address.value = s.address ?? ""
    if (s.holidayCountry !== undefined) holidayCountry.value = s.holidayCountry ?? ""
    if (s.holidayProvince !== undefined) holidayProvince.value = s.holidayProvince ?? ""
    if (s.lat !== undefined) lat.value = s.lat ?? null
    if (s.lon !== undefined) lon.value = s.lon ?? null
    if (s.widgetLayout) updateWidgetLayout(s.widgetLayout)
    if (s.camera !== undefined) applyCameraSettings(s.camera)
    if (s.wifi !== undefined) applyWifiSettings(s.wifi)
    if (s.notifications) {
      if (s.notifications.hud !== undefined) updateHudEnabled(s.notifications.hud !== false)
      updateDefaultReminderMinutes(s.notifications.defaultReminderMinutes ?? null)
    }
    if (s.music) {
      if (s.music.lyrics !== undefined) updateLyricsEnabled(s.music.lyrics !== false)
      if (s.music.lyricsOffsetMs !== undefined) updateLyricsOffset(Number(s.music.lyricsOffsetMs))
      if (s.music.background !== undefined) updateMusicBackground(s.music.background !== false)
      if (s.music.backgroundSpin !== undefined) updateMusicBackgroundSpin(s.music.backgroundSpin !== false)
      if (s.music.cardSpin !== undefined) updateMusicCardSpin(s.music.cardSpin !== false)
    }
    if (s.screens) {
      if (s.screens.carousel !== undefined) updateCarouselEnabled(s.screens.carousel !== false)
      if (s.screens.returnHome !== undefined) updateReturnHomeEnabled(s.screens.returnHome === true)
      if (s.screens.autoHideNav !== undefined) updateNavAutoHide(s.screens.autoHideNav === true)
      if (s.screens.autoRefresh !== undefined) updateAutoRefreshEnabled(s.screens.autoRefresh === true)
      if (s.screens.refreshIntervalMinutes !== undefined) {
        updateAutoRefreshMinutes(Number(s.screens.refreshIntervalMinutes))
      }
    }
    if (!accentSets[themePreset.value].includes(accentColor.value)) {
      accentColor.value = presetDefaultAccent[themePreset.value]
    }
    accentMemory[themePreset.value] = accentColor.value
    applyThemePresetToDOM(themePreset.value)
    applyAccentToDOM(accentColor.value)
    applyFontSizeToDOM(fontSize.value)
  } finally {
    void nextTick(() => { serverApplyDepth-- })
  }
}

export async function refreshPhotos() {
  const list = await photosApi.list().catch(() => null)
  if (list) photos.value = Array.isArray(list) ? list : []
}

export async function refreshFromServer() {
  const s = await householdApi.getSettings()
  applyHouseholdSettings(s)
  await refreshPhotos()
}

export function useSettings() {
  return {
    theme, themePreset, accentColor, fontSize, warm, hudEnabled, houseName, photos,
    widgetLayout, address, holidayCountry, holidayProvince, lat, lon,
    lyricsEnabled, lyricsOffsetMs, musicBackground, musicBackgroundSpin, musicCardSpin,
    carouselEnabled, returnHomeEnabled,
    navAutoHide, autoRefreshEnabled, autoRefreshMinutes,
    cameraUrl, cameraUsername, cameraPasswordSet, cameraRotation, cameraStreamPath,
    wifiSsid, wifiPassword, wifiEncryption, wifiHidden,
    defaultReminderMinutes,
    autoThemeDark, autoSunrise, autoSunset,
    accentPalette, accentSets, fontSizeScale,
    applyAccentToDOM, applyFontSizeToDOM,
    updateTheme, updateThemePreset, updateAccentColor, updateFontSize, updateWarm, updateHudEnabled,
    updateLyricsEnabled, updateLyricsOffset, updateMusicBackground, updateMusicBackgroundSpin, updateMusicCardSpin,
    updateCarouselEnabled, updateReturnHomeEnabled,
    updateNavAutoHide, updateAutoRefreshEnabled, updateAutoRefreshMinutes,
    updateHouseName, updateDefaultReminderMinutes, applyCameraSettings,
    applyWifiSettings, updateWidgetLayout,
    applyHouseholdSettings, refreshFromServer, refreshPhotos,
  }
}

export function _resetSettings() {
  theme.value = "system"
  themePreset.value = "futur"
  accentColor.value = "mint"
  fontSize.value = "large"
  warm.value = false
  autoThemeDark.value = null
  autoSunrise.value = null
  autoSunset.value = null
  hudEnabled.value = true
  lyricsEnabled.value = true
  lyricsOffsetMs.value = 0
  musicBackground.value = true
  musicBackgroundSpin.value = false
  musicCardSpin.value = true
  carouselEnabled.value = false
  returnHomeEnabled.value = true
  navAutoHide.value = false
  autoRefreshEnabled.value = false
  autoRefreshMinutes.value = 60
  houseName.value = ""
  photos.value = []
  widgetLayout.value = []
  address.value = ""
  holidayCountry.value = ""
  holidayProvince.value = ""
  lat.value = null
  lon.value = null
  cameraUrl.value = ""
  cameraUsername.value = ""
  cameraPasswordSet.value = false
  cameraRotation.value = 0
  cameraStreamPath.value = null
  wifiSsid.value = ""
  wifiPassword.value = ""
  wifiEncryption.value = "WPA"
  wifiHidden.value = false
  defaultReminderMinutes.value = null
  serverApplyDepth = 0
  accentMemory.default = presetDefaultAccent.default
  accentMemory.futur = presetDefaultAccent.futur
  applyThemePresetToDOM("futur")
  applyAccentToDOM("mint")
}

import { nextTick, ref } from "vue"
import { householdApi } from "@/api/household"
import type { CameraSettings, HouseholdSettings } from "@/api/household"
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
  /** Text/icon color that stays legible on top of `base`. */
  onAccent: string
}

export const accentPalette: Record<AccentColor, AccentPaletteEntry> = {
  peach:  { base: "#fcd0a1", light: "#fde0c6", lighter: "#feeedb", dark: "#caa681", darker: "#977c61", onAccent: "#1c2828" },
  sage:   { base: "#b1b695", light: "#c5c8af", lighter: "#d8dac9", dark: "#8e9277", darker: "#6a6e59", onAccent: "#1c2828" },
  mauve:  { base: "#a690a4", light: "#c4b7c3", lighter: "#e2dde2", dark: "#857383", darker: "#645663", onAccent: "#1c2828" },
  plum:   { base: "#5e4b56", light: "#92818b", lighter: "#c5bcc1", dark: "#4b3c45", darker: "#382d34", onAccent: "#fafafa" },
  sky:    { base: "#afd2e9", light: "#c3deef", lighter: "#d7eaf4", dark: "#8ca8ba", darker: "#697e8c", onAccent: "#1c2828" },
  // Theme-preset "futur" accents.
  mint:   { base: "#8ae3c6", light: "#b5f3df", lighter: "#d6f8ec", dark: "#4fb99c", darker: "#16756b", onAccent: "#15171c" },
  honey:  { base: "#e0a21a", light: "#f2c64b", lighter: "#fce3a0", dark: "#b27a0b", darker: "#8a6206", onAccent: "#15171c" },
  violet: { base: "#6b5aa0", light: "#a99bd2", lighter: "#cfc7e7", dark: "#52447f", darker: "#3b305e", onAccent: "#fffdf4" },
  clay:   { base: "#c96a12", light: "#e08a2a", lighter: "#f5c98f", dark: "#9e4e08", darker: "#7a3b05", onAccent: "#15171c" },
  aqua:   { base: "#67d5e0", light: "#9ae7ef", lighter: "#c9f5f8", dark: "#2a9fac", darker: "#17666f", onAccent: "#15171c" },
}

/** Accent choices exposed by each theme preset, in display order. */
export const accentSets: Record<ThemePreset, AccentColor[]> = {
  default: ["peach", "sage", "mauve", "plum", "sky"],
  futur:   ["mint", "honey", "violet", "clay", "aqua"],
}

/** Accent selected when moving into a preset whose current accent is unavailable. */
export const presetDefaultAccent: Record<ThemePreset, AccentColor> = {
  default: "sage",
  futur: "mint",
}

/** Member avatars keep the original five families so the picker stays compact. */
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
/** Server-resolved day/night state while `theme` is "auto". Null until known. */
const autoThemeDark = ref<boolean | null>(null)
/** Today's sunrise/sunset (ISO 8601, household timezone) while theme is auto. */
const autoSunrise = ref<string | null>(null)
const autoSunset = ref<string | null>(null)
const hudEnabled = ref(true)
/** Now-playing extras: the lyrics overlay, the full-screen cover, its spin, and the card's spin. */
const lyricsEnabled = ref(true)
const musicBackground = ref(true)
const musicBackgroundSpin = ref(false)
const musicCardSpin = ref(true)
const houseName = ref("")
const photos = ref<PhotoEntry[]>([])
/** RTSP camera details exposed by the server (never the password itself). */
const cameraUrl = ref("")
const cameraUsername = ref("")
const cameraPasswordSet = ref(false)
const cameraRotation = ref(0)
const cameraStreamPath = ref<string | null>(null)
/** Household default reminder lead (minutes before start); null = no default. */
const defaultReminderMinutes = ref<number | null>(null)
/** Last accent picked in each preset, so switching back restores it. */
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
  // Hover stays legible: accents with light text darken, all others lighten.
  const darkHover = p.onAccent === "#fffdf4" || p.onAccent === "#fafafa"
  root.style.setProperty("--color-actionHover", darkHover ? p.dark : p.light)
  if (themePreset.value === "futur") {
    // Futur uses flat cutout depth: a hard ink lip, no tinted blur.
    root.style.setProperty("--shadow-accent-lip", "var(--color-ink)")
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
    // Drop the resolved sun state so a later offline switch to auto falls
    // back to the OS instead of reusing yesterday's day/night flag.
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

function updateMusicBackground(on: boolean) {
  musicBackground.value = on
}

function updateMusicBackgroundSpin(on: boolean) {
  musicBackgroundSpin.value = on
}

function updateMusicCardSpin(on: boolean) {
  musicCardSpin.value = on
}

function updateHouseName(name: string) {
  houseName.value = name
}

function applyCameraSettings(camera: CameraSettings | null) {
  cameraUrl.value = camera?.url ?? ""
  cameraUsername.value = camera?.username ?? ""
  cameraPasswordSet.value = camera?.passwordSet === true
  cameraRotation.value = camera?.rotation ?? 0
  cameraStreamPath.value = camera?.streamPath ?? null
}

function updateDefaultReminderMinutes(minutes: number | null) {
  defaultReminderMinutes.value = minutes
}

/**
 * Depth counter for server-driven applies (initial load, reconnect resync, SSE
 * broadcast). While it is non-zero the persistence watcher in App.vue skips
 * PATCHing, so a broadcast echoed back to us can never be written to the
 * server again — or race a newer change with stale values.
 */
let serverApplyDepth = 0

/** True while a server payload is being applied (and its watchers are flushing). */
export function isApplyingRemoteSettings(): boolean {
  return serverApplyDepth > 0
}

/** Apply a household-settings payload to the local refs and the DOM. Absent keys are left alone. */
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
    if (s.camera !== undefined) applyCameraSettings(s.camera)
    if (s.notifications) {
      if (s.notifications.hud !== undefined) updateHudEnabled(s.notifications.hud !== false)
      updateDefaultReminderMinutes(s.notifications.defaultReminderMinutes ?? null)
    }
    if (s.music) {
      if (s.music.lyrics !== undefined) updateLyricsEnabled(s.music.lyrics !== false)
      if (s.music.background !== undefined) updateMusicBackground(s.music.background !== false)
      if (s.music.backgroundSpin !== undefined) updateMusicBackgroundSpin(s.music.backgroundSpin !== false)
      if (s.music.cardSpin !== undefined) updateMusicCardSpin(s.music.cardSpin !== false)
    }
    // Keep the accent and preset coherent if an older/partial payload is loaded.
    if (!accentSets[themePreset.value].includes(accentColor.value)) {
      accentColor.value = presetDefaultAccent[themePreset.value]
    }
    accentMemory[themePreset.value] = accentColor.value
    applyThemePresetToDOM(themePreset.value)
    applyAccentToDOM(accentColor.value)
    applyFontSizeToDOM(fontSize.value)
  } finally {
    // Keep the guard set through the watcher flush so persistence watchers see
    // it, then release (Vue runs nextTick callbacks after flush jobs).
    void nextTick(() => { serverApplyDepth-- })
  }
}

/** Re-fetch the shared photo list and apply it. */
export async function refreshPhotos() {
  const list = await photosApi.list().catch(() => null)
  if (list) photos.value = Array.isArray(list) ? list : []
}

/**
 * Re-fetch household settings and photos and apply them. Used when a client
 * resyncs after a reconnect, so changes made while it was offline (theme,
 * reminder default, widget layout, photos) are picked up.
 */
export async function refreshFromServer() {
  const s = await householdApi.getSettings()
  applyHouseholdSettings(s)
  if (s.widgetLayout) {
    window.dispatchEvent(new CustomEvent(HOME_LAYOUT_EVENT, { detail: s.widgetLayout }))
  }
  await refreshPhotos()
}

export function useSettings() {
  return {
    theme, themePreset, accentColor, fontSize, warm, hudEnabled, houseName, photos,
    lyricsEnabled, musicBackground, musicBackgroundSpin, musicCardSpin,
    cameraUrl, cameraUsername, cameraPasswordSet, cameraRotation, cameraStreamPath,
    defaultReminderMinutes,
    autoThemeDark, autoSunrise, autoSunset,
    accentPalette, accentSets, fontSizeScale,
    applyAccentToDOM, applyFontSizeToDOM,
    updateTheme, updateThemePreset, updateAccentColor, updateFontSize, updateWarm, updateHudEnabled,
    updateLyricsEnabled, updateMusicBackground, updateMusicBackgroundSpin, updateMusicCardSpin,
    updateHouseName, updateDefaultReminderMinutes, applyCameraSettings,
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
  musicBackground.value = true
  musicBackgroundSpin.value = false
  musicCardSpin.value = true
  houseName.value = ""
  photos.value = []
  cameraUrl.value = ""
  cameraUsername.value = ""
  cameraPasswordSet.value = false
  cameraRotation.value = 0
  cameraStreamPath.value = null
  defaultReminderMinutes.value = null
  serverApplyDepth = 0
  accentMemory.default = presetDefaultAccent.default
  accentMemory.futur = presetDefaultAccent.futur
  applyThemePresetToDOM("futur")
  applyAccentToDOM("mint")
}

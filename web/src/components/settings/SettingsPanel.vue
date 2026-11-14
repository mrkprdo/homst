<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue"
import {
  useSettings,
  applyHouseholdSettings,
  type Theme,
  type ThemePreset,
  type AccentColor,
  type FontSize,
  accentPalette,
  accentSets,
} from "@/composables/useSettings"
import { getAnimationEnabled, setAnimationEnabled } from "@/lib/motion"
import { householdApi } from "@/api/household"
import { DEFAULT_LAYOUT, writeCachedHomeLayout } from "@/lib/homeLayout"
import { notificationsApi } from "@/api/notifications"
import { isServerUnreachable } from "@/api/client"
import { usePush } from "@/composables/usePush"
import {
  SERVER_UNREACHABLE_TITLE,
  useServerReachability,
} from "@/composables/useServerReachability"
import { REMINDER_OPTIONS, reminderMinutesFromValue } from "@/utils/reminders"
import {
  PhSun,
  PhMoon,
  PhSunHorizon,
  PhDesktop,
  PhCheck,
  PhDeviceMobile,
  PhDownloadSimple,
  PhWarningCircle,
  PhCaretLeft,
  PhCaretRight,
  PhMagnifyingGlass,
  PhX,
} from "@phosphor-icons/vue"
import PageHeader from "@/components/ui/PageHeader.vue"
import UiSegmentedControl from "@/components/ui/UiSegmentedControl.vue"
import UiToggle from "@/components/ui/UiToggle.vue"
import UiButton from "@/components/ui/UiButton.vue"
import UiInput from "@/components/ui/UiInput.vue"
import UiSelect from "@/components/ui/UiSelect.vue"
import SoftwareUpdateCard from "@/components/settings/SoftwareUpdateCard.vue"
import NestSettingsCard from "@/components/settings/NestSettingsCard.vue"

const settings = useSettings()

const colorNames: Record<AccentColor, string> = {
  sage:  "Sage",
  peach: "Peach",
  mauve: "Mauve",
  plum:  "Plum",
  sky:   "Sky",
  mint:  "Mint",
  honey: "Honey",
  violet: "Violet",
  clay:  "Clay",
  aqua:  "Aqua",
}

const themePresets: {
  value: ThemePreset
  label: string
  desc: string
  swatches: string[]
}[] = [
  {
    value: "futur",
    label: "Futur",
    desc: "Flat color, ink outlines",
    swatches: [accentPalette.mint.base, accentPalette.honey.base, accentPalette.violet.base],
  },
  {
    value: "default",
    label: "Clay-o",
    desc: "Soft clay, muted accents",
    swatches: [accentPalette.sage.base, accentPalette.peach.base, accentPalette.mauve.base],
  },
]

const defaultThemeOptions: { value: Theme; label: string; icon: typeof PhSun; desc: string }[] = [
  { value: "light",  label: "Light",  icon: PhSun,        desc: "Always light"      },
  { value: "dark",   label: "Dark",   icon: PhMoon,       desc: "Always dark"       },
  { value: "auto",   label: "Auto",   icon: PhSunHorizon, desc: "Sunrise & sunset"  },
  { value: "system", label: "System", icon: PhDesktop,    desc: "Follows OS"        },
]

const futurThemeOptions: typeof defaultThemeOptions = [
  { value: "light",  label: "Day",    icon: PhSun,        desc: "Cream paper"      },
  { value: "dark",   label: "Night",  icon: PhMoon,       desc: "Deep navy"        },
  { value: "auto",   label: "Auto",   icon: PhSunHorizon, desc: "Sunrise & sunset" },
  { value: "system", label: "System", icon: PhDesktop,    desc: "Follows OS"       },
]

const appearanceOptions = computed(() =>
  settings.themePreset.value === "futur" ? futurThemeOptions : defaultThemeOptions
)

const hasLocation = ref<boolean | null>(null)

function sunTime(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

const autoSchedule = computed(() => {
  const sunrise = sunTime(settings.autoSunrise.value)
  const sunset = sunTime(settings.autoSunset.value)
  return sunrise && sunset ? `Sunrise ${sunrise} · Sunset ${sunset}` : ""
})

/**
 * Auto needs the server to resolve sunrise/sunset, so ask for the new state in
 * the same round-trip instead of waiting for the debounced settings watcher.
 * Other themes apply immediately and persist through that watcher.
 */
let themeRequest = 0
async function selectTheme(theme: Theme) {
  const request = ++themeRequest
  if (theme !== "auto") {
    settings.updateTheme(theme)
    return
  }
  try {
    const res = await householdApi.updateSettings({ theme: "auto" })
    // A newer click won while this request was in flight.
    if (request !== themeRequest) return
    applyHouseholdSettings(res.settings ?? { theme: "auto" })
  } catch {
    if (request !== themeRequest) return
    // Offline: keep auto selected; it falls back to the OS preference until
    // the next successful load supplies the server's day/night state.
    settings.updateTheme("auto")
  }
}

const colorOptions = computed<{ value: AccentColor; hex: string; name: string }[]>(() =>
  accentSets[settings.themePreset.value].map((key) => ({
    value: key,
    hex: accentPalette[key].base,
    name: colorNames[key],
  }))
)

const activePreset = computed(() =>
  themePresets.find(p => p.value === settings.themePreset.value) ?? themePresets[0]!
)

const currentAppearanceLabel = computed(() =>
  appearanceOptions.value.find(opt => opt.value === settings.theme.value)?.label ?? ""
)

const accentDescription = computed(() =>
  settings.themePreset.value === "futur"
    ? "Sets the field and action color for the flat palette"
    : "Tints buttons, highlights, and interactive elements"
)

const appearanceDescription = computed(() =>
  settings.themePreset.value === "futur"
    ? "Choose the light for the flat palette on every screen"
    : "Choose how the interface looks on every screen"
)

const warmTitle = computed(() =>
  settings.themePreset.value === "futur" ? "Warm paper" : "Warm lighting"
)

const warmDescription = computed(() =>
  settings.themePreset.value === "futur"
    ? "Shifts the palette toward honey and clay"
    : "Tints the interface to blend with warm room light"
)

const fontSizeOptions: { label: string; value: FontSize }[] = [
  { label: "S",  value: "small"  },
  { label: "M",  value: "medium" },
  { label: "L",  value: "large"  },
  { label: "XL", value: "xlarge" },
]

const fontSizeNames: Record<FontSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  xlarge: "Extra large",
}

const currentFontSizeName = computed(() => fontSizeNames[settings.fontSize.value] ?? "")

const selectedColorName = computed(() => colorNames[settings.accentColor.value] ?? "Custom")

// ── Home layout ──
const confirmingLayoutReset = ref(false)
const resettingLayout = ref(false)
const resetLayoutMessage = ref("")
const resetLayoutError = ref("")

function askToResetLayout() {
  resetLayoutMessage.value = ""
  resetLayoutError.value = ""
  confirmingLayoutReset.value = true
}

async function resetHomeLayout() {
  resettingLayout.value = true
  resetLayoutError.value = ""
  resetLayoutMessage.value = ""
  // Paint the default immediately on the next home visit, even before the
  // server round-trip completes.
  const layout = DEFAULT_LAYOUT.map(card => ({ ...card }))
  writeCachedHomeLayout(layout)
  try {
    await householdApi.updateSettings({ widgetLayout: layout })
    resetLayoutMessage.value = "Home layout reset to the default."
    confirmingLayoutReset.value = false
  } catch {
    resetLayoutError.value = "Could not save the layout. Check the connection and try again."
  } finally {
    resettingLayout.value = false
  }
}

const animationsEnabled = ref(getAnimationEnabled())
const systemReducedMotion = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

watch(animationsEnabled, (enabled) => {
  setAnimationEnabled(enabled)
})

// ── Reminders ──
const defaultReminder = ref("")
const testing = ref(false)
const testResults = ref<Record<string, string> | null>(null)
const testUnreachable = ref(false)
const { serverReachable } = useServerReachability()

const {
  supported: pushSupported,
  subscribed: pushSubscribed,
  busy: pushBusy,
  error: pushError,
  supportDetail: pushSupportDetail,
  refresh: refreshPush,
  enable: enablePush,
  disable: disablePush,
} = usePush()

const CHANNEL_LABELS: Record<string, string> = { hud: "Display", push: "Phone" }

onMounted(async () => {
  refreshPush()
  const s = await householdApi.getSettings().catch(() => null)
  if (s) hasLocation.value = typeof s.lat === "number" && typeof s.lon === "number"
  const n = s?.notifications
  if (n) {
    settings.updateHudEnabled(n.hud !== false)
    settings.updateDefaultReminderMinutes(n.defaultReminderMinutes ?? null)
  }
  if (s?.camera) {
    cameraUrl.value = s.camera.url ?? ""
    cameraUsername.value = s.camera.username ?? ""
    cameraRotation.value = String(s.camera.rotation ?? 0)
    settings.applyCameraSettings(s.camera)
  }
  defaultReminder.value = settings.defaultReminderMinutes.value != null
    ? String(settings.defaultReminderMinutes.value)
    : ""
})

/** Mirror reminder preferences changed on another client (SSE broadcast). */
watch(() => settings.defaultReminderMinutes.value, (minutes) => {
  defaultReminder.value = minutes != null ? String(minutes) : ""
})

watch(serverReachable, (reachable) => {
  if (reachable) testUnreachable.value = false
})

/** Toggling push turns *this* device's subscription on or off (per device). */
async function onPushToggle(enabled: boolean) {
  if (enabled) await enablePush()
  else await disablePush()
}

function saveNotifications() {
  householdApi.updateSettings({
    notifications: {
      hud: settings.hudEnabled.value,
      defaultReminderMinutes: settings.defaultReminderMinutes.value,
    },
  }).catch(() => {})
}

/** "On this display" is household-wide (the server gates HUD delivery on it). */
function onHudToggle(enabled: boolean) {
  settings.updateHudEnabled(!!enabled)
  saveNotifications()
}

/** Now-playing choices are household-wide: every screen shows the same thing. */
const musicSetters = {
  lyrics: settings.updateLyricsEnabled,
  background: settings.updateMusicBackground,
  backgroundSpin: settings.updateMusicBackgroundSpin,
  cardSpin: settings.updateMusicCardSpin,
} as const

/** Every music PATCH carries the whole block, so none of the choices drop out. */
function musicPayload() {
  return {
    lyrics: settings.lyricsEnabled.value,
    lyricsOffsetMs: settings.lyricsOffsetMs.value,
    background: settings.musicBackground.value,
    backgroundSpin: settings.musicBackgroundSpin.value,
    cardSpin: settings.musicCardSpin.value,
  }
}

let lyricsOffsetSaveTimer: ReturnType<typeof setTimeout> | null = null

function saveMusic() {
  if (lyricsOffsetSaveTimer !== null) {
    clearTimeout(lyricsOffsetSaveTimer)
    lyricsOffsetSaveTimer = null
  }
  householdApi.updateSettings({ music: musicPayload() }).catch(() => {})
}

function onMusicToggle(key: keyof typeof musicSetters, value: boolean) {
  musicSetters[key](!!value)
  saveMusic()
}

const lyricsOffsetLabel = computed(() => {
  const seconds = settings.lyricsOffsetMs.value / 1000
  const sign = seconds > 0 ? "+" : seconds < 0 ? "−" : ""
  return `${sign}${Math.abs(seconds).toFixed(2)} s`
})

/** Nudge the delay in 50 ms steps; the delay is persisted once the tapping stops. */
function onLyricsOffset(deltaMs: number) {
  settings.updateLyricsOffset(settings.lyricsOffsetMs.value + deltaMs)
  if (lyricsOffsetSaveTimer !== null) clearTimeout(lyricsOffsetSaveTimer)
  lyricsOffsetSaveTimer = setTimeout(() => {
    lyricsOffsetSaveTimer = null
    householdApi.updateSettings({ music: musicPayload() }).catch(() => {})
  }, 350)
}

function resetLyricsOffset() {
  settings.updateLyricsOffset(0)
  saveMusic()
}

/** Kiosk screen choices are household-wide, like the music options. */
function onScreenToggle(key: "carousel" | "returnHome", value: boolean) {
  if (key === "carousel") settings.updateCarouselEnabled(!!value)
  else settings.updateReturnHomeEnabled(!!value)
  householdApi.updateSettings({
    screens: {
      carousel: settings.carouselEnabled.value,
      returnHome: settings.returnHomeEnabled.value,
    },
  }).catch(() => {})
}

// ── Camera ──
const cameraUrl = ref("")
const cameraUsername = ref("")
const cameraPassword = ref("")
const cameraRotation = ref("0")
const cameraSaving = ref(false)
const cameraMessage = ref("")
const cameraError = ref("")

async function saveCamera() {
  cameraSaving.value = true
  cameraMessage.value = ""
  cameraError.value = ""
  const url = cameraUrl.value.trim()
  const camera: { url: string; username: string; rotation: number; password?: string } = {
    url,
    username: cameraUsername.value.trim(),
    rotation: Number(cameraRotation.value),
  }
  if (cameraPassword.value) camera.password = cameraPassword.value
  try {
    const res = await householdApi.updateSettings({ camera })
    if (res.settings) applyHouseholdSettings(res.settings)
    cameraPassword.value = ""
    cameraMessage.value = url ? "Camera saved." : "Camera removed."
  } catch (err) {
    cameraError.value = err instanceof Error ? err.message : "Could not save the camera."
  } finally {
    cameraSaving.value = false
  }
}

function removeCamera() {
  cameraUrl.value = ""
  cameraUsername.value = ""
  cameraPassword.value = ""
  cameraRotation.value = "0"
  void saveCamera()
}

/** Keep the shared settings store in sync so event forms pre-fill immediately. */
function onDefaultReminderChange(value: string) {
  defaultReminder.value = value
  settings.updateDefaultReminderMinutes(reminderMinutesFromValue(value))
  saveNotifications()
}

/** Fire a reminder at every client: all open screens (HUD) and all phones (push). */
async function sendTest() {
  testing.value = true
  testResults.value = null
  testUnreachable.value = false
  try {
    const res = await notificationsApi.sendTest({ channels: ["hud", "push"] })
    testResults.value = res.results
  } catch (err) {
    if (isServerUnreachable(err)) {
      testUnreachable.value = true
    } else {
      testResults.value = { hud: "failed: could not send the test" }
    }
  } finally {
    testing.value = false
  }
}

// ── Search ──
// The cards are hand-written sections, so instead of teaching every one of
// them about the query, the panel filters its own children: a card stays if
// its text holds every word in the search. Matches are painted with the CSS
// Highlight API, which marks ranges without touching the DOM Vue owns.
const HIGHLIGHT_NAME = "settings-search"

const searchQuery = ref("")
const searchInputEl = ref<HTMLInputElement | null>(null)
const masonryEl = ref<HTMLElement | null>(null)
const matchCount = ref(0)
const cardCount = ref(0)

const searchTokens = computed(() => searchQuery.value.toLowerCase().split(/\s+/).filter(Boolean))
const searching = computed(() => searchTokens.value.length > 0)

/** Chromium, Safari 17.2+, and Firefox 140+ paint ranges; elsewhere filtering still works. */
function highlightSupport() {
  if (typeof CSS === "undefined" || typeof Highlight === "undefined") return null
  if (!CSS.highlights) return null
  return { registry: CSS.highlights, Highlight }
}

const highlight = highlightSupport()

const UNSEARCHABLE = new Set(["SCRIPT", "STYLE", "INPUT", "TEXTAREA", "SELECT", "OPTION", "NOSCRIPT"])

function collectMatches(root: HTMLElement, tokens: string[], ranges: Range[]) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || UNSEARCHABLE.has(parent.tagName) || !node.nodeValue) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const text = node.nodeValue ?? ""
    const lower = text.toLowerCase()
    for (const token of tokens) {
      let from = 0
      for (;;) {
        const index = lower.indexOf(token, from)
        if (index < 0) break
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + token.length)
        ranges.push(range)
        from = index + token.length
      }
    }
  }
}

function paintMatches(ranges: Range[]) {
  if (!highlight) return
  if (ranges.length === 0) {
    highlight.registry.delete(HIGHLIGHT_NAME)
    return
  }
  highlight.registry.set(HIGHLIGHT_NAME, new highlight.Highlight(...ranges))
}

function applySearch() {
  const root = masonryEl.value
  if (!root) return

  const cards = Array.from(root.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  )
  const tokens = searchTokens.value
  const ranges: Range[] = []
  let matches = 0

  for (const card of cards) {
    const text = (card.textContent ?? "").toLowerCase()
    const visible = tokens.length === 0 || tokens.every((token) => text.includes(token))
    card.classList.toggle("is-filtered-out", !visible)
    if (!visible) continue
    matches += 1
    if (tokens.length) collectMatches(card, tokens, ranges)
  }

  cardCount.value = cards.length
  matchCount.value = matches
  paintMatches(ranges)
}

function clearSearch() {
  searchQuery.value = ""
  searchInputEl.value?.focus()
}

// Vue patches text as settings change (a nested row appears, a version arrives),
// so re-run the filter whenever the cards' content moves.
let searchObserver: MutationObserver | null = null

onMounted(() => {
  applySearch()
  if (typeof MutationObserver === "undefined" || !masonryEl.value) return
  searchObserver = new MutationObserver(applySearch)
  searchObserver.observe(masonryEl.value, { childList: true, subtree: true, characterData: true })
})

onBeforeUnmount(() => {
  searchObserver?.disconnect()
  paintMatches([])
})

watch(searchTokens, applySearch, { flush: "post" })
</script>

<template>
  <div class="settings-panel">
    <PageHeader title="Settings" />

    <div class="settings-search" role="search">
      <PhMagnifyingGlass :size="18" class="settings-search__icon" aria-hidden="true" />
      <input
        ref="searchInputEl"
        v-model="searchQuery"
        class="settings-search__input"
        type="search"
        placeholder="Search settings"
        aria-label="Search settings"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        @keydown.esc.prevent="clearSearch"
      />
      <span class="settings-search__count" aria-live="polite">
        <template v-if="searching">{{ matchCount }} {{ matchCount === 1 ? "card" : "cards" }}</template>
      </span>
      <button
        v-if="searchQuery"
        class="settings-search__clear"
        type="button"
        aria-label="Clear search"
        @click="clearSearch"
      >
        <PhX :size="16" weight="bold" aria-hidden="true" />
      </button>
    </div>

    <div ref="masonryEl" class="settings-masonry">
      <!-- ── Theme ── -->
      <section class="settings-card settings-card--preset">
        <header class="card-header">
          <div class="card-heading">
            <h3 class="card-title">Theme</h3>
            <p class="card-desc">Choose the visual language for every screen</p>
          </div>
          <span class="selected-badge">{{ activePreset.label }}</span>
        </header>

        <div class="card-body">
          <div class="option-grid option-grid--presets">
            <button
              v-for="preset in themePresets"
              :key="preset.value"
              class="preset-card option-tile"
              :class="{ active: settings.themePreset.value === preset.value }"
              :aria-pressed="settings.themePreset.value === preset.value"
              @click="settings.updateThemePreset(preset.value)"
            >
              <span class="option-media">
                <span class="preset-preview" :class="`preset-preview--${preset.value}`">
                  <span
                    v-for="(swatch, i) in preset.swatches"
                    :key="i"
                    class="preset-swatch"
                    :style="{ backgroundColor: swatch }"
                  />
                </span>
                <span v-if="settings.themePreset.value === preset.value" class="option-check">
                  <PhCheck :size="13" weight="bold" />
                </span>
              </span>
              <span class="option-copy">
                <span class="preset-label">{{ preset.label }}</span>
                <span class="preset-desc">{{ preset.desc }}</span>
              </span>
            </button>
          </div>
        </div>
      </section>

      <!-- ── Accent Color ── -->
      <section class="settings-card settings-card--accent">
        <header class="card-header">
          <div class="card-heading">
            <h3 class="card-title">Accent Color</h3>
            <p class="card-desc">{{ accentDescription }}</p>
          </div>
          <span class="selected-badge">{{ selectedColorName }}</span>
        </header>

        <div class="card-body card-body--center">
          <div class="color-grid">
            <button
              v-for="color in colorOptions"
              :key="color.value"
              class="color-option"
              :class="{ active: settings.accentColor.value === color.value }"
              :aria-pressed="settings.accentColor.value === color.value"
              :aria-label="color.name"
              @click="settings.updateAccentColor(color.value)"
            >
              <span
                class="color-swatch"
                :class="{ active: settings.accentColor.value === color.value }"
                :style="{ backgroundColor: color.hex }"
                :title="color.name"
              >
                <PhCheck
                  v-if="settings.accentColor.value === color.value"
                  :size="15"
                  weight="bold"
                  class="swatch-check"
                />
              </span>
              <span class="color-name">{{ color.name }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- ── Appearance ── -->
      <section class="settings-card settings-card--appearance">
        <header class="card-header">
          <div class="card-heading">
            <h3 class="card-title">Appearance</h3>
            <p class="card-desc">{{ appearanceDescription }}</p>
          </div>
          <span class="selected-badge">{{ currentAppearanceLabel }}</span>
        </header>

        <div class="card-body">
          <div class="option-grid option-grid--appearance">
            <button
              v-for="opt in appearanceOptions"
              :key="opt.value"
              class="theme-card option-tile"
              :class="{ active: settings.theme.value === opt.value }"
              :aria-pressed="settings.theme.value === opt.value"
              @click="selectTheme(opt.value)"
            >
              <span class="option-media">
                <span class="theme-icon-field">
                  <component :is="opt.icon" :size="22" class="theme-icon" />
                </span>
                <span v-if="settings.theme.value === opt.value" class="option-check">
                  <PhCheck :size="13" weight="bold" />
                </span>
              </span>
              <span class="option-copy">
                <span class="theme-label">{{ opt.label }}</span>
                <span class="theme-desc">{{ opt.desc }}</span>
              </span>
            </button>
          </div>

          <p v-if="settings.theme.value === 'auto'" class="card-note auto-note">
            <PhSunHorizon :size="15" />
            <span v-if="autoSchedule">{{ autoSchedule }}</span>
            <span v-else-if="hasLocation === false">
              Add a home address in your profile to use sunrise and sunset.
            </span>
            <span v-else>Sunrise and sunset are unavailable for this location today.</span>
          </p>

          <div class="setting-row">
            <div class="row-copy">
              <p class="row-title">{{ warmTitle }}</p>
              <p class="row-desc">{{ warmDescription }}</p>
            </div>
            <UiToggle
              :model-value="settings.warm.value"
              @update:model-value="settings.updateWarm"
            />
          </div>
        </div>
      </section>

      <!-- ── Text Size ── -->
      <section class="settings-card settings-card--textsize">
        <header class="card-header">
          <div class="card-heading">
            <h3 class="card-title">Text Size</h3>
            <p class="card-desc">Scales all text across the app</p>
          </div>
          <span class="selected-badge">{{ currentFontSizeName }}</span>
        </header>

        <div class="card-body">
          <UiSegmentedControl
            class="font-segments"
            :model-value="settings.fontSize.value"
            :options="fontSizeOptions"
            @update:model-value="(v) => settings.updateFontSize(v as FontSize)"
          />
          <div class="font-preview">
            <p class="preview-heading">The quick brown fox</p>
            <p class="preview-body">Jumps over the lazy dog. Plan your day, share your space.</p>
          </div>
        </div>
      </section>

      <!-- ── Reminders ── -->
      <section class="settings-card settings-card--reminders">
        <header class="card-header">
          <div class="card-heading">
            <h3 class="card-title">Reminders</h3>
            <p class="card-desc">Upcoming events announce themselves before they start</p>
          </div>
        </header>

        <div class="card-body">
          <div class="setting-row">
            <div class="row-copy">
              <p class="row-title">On this display</p>
              <p class="row-desc">A reminder card appears on screen</p>
            </div>
            <UiToggle
              :model-value="settings.hudEnabled.value"
              @update:model-value="onHudToggle"
            />
          </div>

          <div class="setting-row">
            <div class="row-copy">
              <p class="row-title">Phone &amp; browser</p>
              <p class="row-desc">
                Push reminders to this device, even when HOMST is closed
                <span v-if="pushSubscribed" class="push-on">· on for this device</span>
              </p>
            </div>
            <UiToggle
              :model-value="pushSubscribed"
              :disabled="!pushSupported || pushBusy"
              @update:model-value="onPushToggle"
            />
          </div>

          <p v-if="pushError" class="card-note card-note--danger push-error">{{ pushError }}</p>
          <p v-else-if="!pushSupported" class="card-note push-hint">
            Push is unavailable here{{ pushSupportDetail ? ` — ${pushSupportDetail}` : "" }}.
            Open HOMST as an installed app over HTTPS; on iPhone or iPad, add it to your Home Screen first.
          </p>

          <div class="setting-row setting-row--stack">
            <div class="row-copy">
              <p class="row-title">Default reminder</p>
              <p class="row-desc">New events start with this reminder time</p>
            </div>
            <UiSelect
              :model-value="defaultReminder"
              class="reminder-default-select"
              @update:model-value="onDefaultReminderChange"
            >
              <option v-for="opt in REMINDER_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </UiSelect>
          </div>

          <div class="test-panel">
            <UiButton size="sm" :disabled="testing" @click="sendTest">
              <PhDeviceMobile :size="14" />{{ testing ? "Sending…" : "Send test to all clients" }}
            </UiButton>
            <div v-if="testResults" class="reminder-results">
              <p v-for="(detail, channel) in testResults" :key="channel" class="reminder-result">
                <strong>{{ CHANNEL_LABELS[channel] ?? channel }}:</strong> {{ detail }}
              </p>
            </div>
            <p v-if="testUnreachable || !serverReachable" class="reminder-notice" role="status">
              <strong>{{ SERVER_UNREACHABLE_TITLE }}.</strong>
            </p>
          </div>
        </div>

        <p class="card-foot">
          Push reminders reach every phone and browser with push turned on —
          no mail account or extra setup needed. The test reaches every open
          screen and every subscribed device.
        </p>
      </section>

      <!-- ── Devices ── -->
      <section class="settings-card settings-card--devices">
        <header class="card-header">
          <div class="card-heading">
            <h3 class="card-title">Add to your devices</h3>
            <p class="card-desc">Install HOMST and turn on notifications on any phone or browser</p>
          </div>
        </header>

        <div class="card-body">
          <div class="setting-row">
            <div class="row-copy">
              <p class="row-title">HTTPS certificate</p>
              <p class="row-desc">
                Phones and browsers only allow install and push over a trusted certificate.
              </p>
            </div>
            <a class="download-btn" href="/ca.pem" download="homst-ca.pem">
              <PhDownloadSimple :size="14" />Download
            </a>
          </div>

          <ol class="install-steps">
            <li class="install-step">
              <span class="step-index">1</span>
              <div class="row-copy">
                <p class="row-title">Download the certificate</p>
                <p class="row-desc">Save it somewhere you can reach from the device.</p>
              </div>
            </li>
            <li class="install-step">
              <span class="step-index">2</span>
              <div class="row-copy">
                <p class="row-title">Install it as a CA certificate</p>
                <p class="row-desc">Open the file on the device and trust it for the system.</p>
              </div>
            </li>
            <li class="install-step">
              <span class="step-index">3</span>
              <div class="row-copy">
                <p class="row-title">Open HOMST on that device</p>
                <p class="row-desc">Use it like an app, then enable push.</p>
              </div>
            </li>
          </ol>
        </div>

        <p class="card-foot">
          On Android: Settings → Security &amp; privacy → More security settings →
          Encryption &amp; credentials → Install a certificate → <strong>CA certificate</strong>.
        </p>
      </section>

      <!-- ── Music ── -->
      <section class="settings-card settings-card--music">
        <header class="card-header">
          <div class="card-heading">
            <h3 class="card-title">Music</h3>
            <p class="card-desc">While music plays on a display</p>
          </div>
        </header>

        <div class="card-body">
          <div class="setting-row">
            <div class="row-copy">
              <p class="row-title">Synced lyrics</p>
              <p class="row-desc">The sung line and the next one along the bottom of the screen</p>
            </div>
            <UiToggle
              :model-value="settings.lyricsEnabled.value"
              @update:model-value="(v: boolean) => onMusicToggle('lyrics', v)"
            />
          </div>

          <div
            v-if="settings.lyricsEnabled.value"
            class="setting-row setting-row--nested setting-row--sync"
          >
            <div class="row-copy">
              <p class="row-title">Lyrics delay</p>
              <p class="row-desc">Left starts the line earlier, right delays it. Up to 2 seconds.</p>
            </div>
            <div class="lyric-offset" role="group" aria-label="Lyrics timing">
              <button
                class="lyric-offset__step"
                type="button"
                title="Earlier"
                aria-label="Make lyrics earlier"
                :disabled="settings.lyricsOffsetMs.value <= -2000"
                @click="onLyricsOffset(-50)"
              >
                <PhCaretLeft :size="16" weight="bold" aria-hidden="true" />
              </button>
              <span class="lyric-offset__value" aria-live="polite">{{ lyricsOffsetLabel }}</span>
              <button
                class="lyric-offset__step"
                type="button"
                title="Later"
                aria-label="Delay lyrics"
                :disabled="settings.lyricsOffsetMs.value >= 2000"
                @click="onLyricsOffset(50)"
              >
                <PhCaretRight :size="16" weight="bold" aria-hidden="true" />
              </button>
              <button
                v-if="settings.lyricsOffsetMs.value !== 0"
                class="lyric-offset__reset"
                type="button"
                @click="resetLyricsOffset"
              >
                Reset
              </button>
            </div>
          </div>

          <div class="setting-row">
            <div class="row-copy">
              <p class="row-title">Album cover background</p>
              <p class="row-desc">The playing album fills the screen behind the dashboard</p>
            </div>
            <UiToggle
              :model-value="settings.musicBackground.value"
              @update:model-value="(v: boolean) => onMusicToggle('background', v)"
            />
          </div>

          <div v-if="settings.musicBackground.value" class="setting-row setting-row--nested">
            <div class="row-copy">
              <p class="row-title">Spin the cover</p>
              <p class="row-desc">Turn the background like a record on a turntable</p>
            </div>
            <UiToggle
              :model-value="settings.musicBackgroundSpin.value"
              @update:model-value="(v: boolean) => onMusicToggle('backgroundSpin', v)"
            />
          </div>

          <div class="setting-row">
            <div class="row-copy">
              <p class="row-title">Spinning album art</p>
              <p class="row-desc">The cover in the now-playing card turns with the music</p>
            </div>
            <UiToggle
              :model-value="settings.musicCardSpin.value"
              @update:model-value="(v: boolean) => onMusicToggle('cardSpin', v)"
            />
          </div>
        </div>

        <p class="card-foot">
          Lyrics come from LRCLIB. A track without synced lyrics shows nothing.
        </p>
      </section>

      <!-- ── Camera ── -->
      <section class="settings-card settings-card--camera">
        <header class="card-header">
          <div class="card-heading">
            <h3 class="card-title">Camera</h3>
            <p class="card-desc">Show an RTSP stream on the home screen</p>
          </div>
        </header>

        <div class="card-body">
          <div class="setting-row setting-row--stack">
            <div class="row-copy">
              <p class="row-title">Stream URL</p>
              <p class="row-desc">rtsp://, rtsps://, http:// or https://</p>
            </div>
            <UiInput
              v-model="cameraUrl"
              class="camera-input"
              placeholder="rtsp://192.168.1.20:554/stream1"
            />
          </div>

          <div class="setting-row setting-row--stack">
            <div class="row-copy">
              <p class="row-title">Username</p>
              <p class="row-desc">Optional — leave blank for anonymous access</p>
            </div>
            <UiInput v-model="cameraUsername" class="camera-input" placeholder="admin" />
          </div>

          <div class="setting-row setting-row--stack">
            <div class="row-copy">
              <p class="row-title">Rotation</p>
              <p class="row-desc">Turn the picture if the camera is mounted sideways</p>
            </div>
            <UiSelect v-model="cameraRotation" class="camera-rotation-select">
              <option value="0">0°</option>
              <option value="90">90°</option>
              <option value="180">180°</option>
              <option value="270">270°</option>
            </UiSelect>
          </div>

          <div class="setting-row setting-row--stack">
            <div class="row-copy">
              <p class="row-title">Password</p>
              <p class="row-desc">
                {{ settings.cameraPasswordSet.value ? "A password is saved. Leave blank to keep it." : "Optional" }}
              </p>
            </div>
            <UiInput
              v-model="cameraPassword"
              type="password"
              class="camera-input"
              :placeholder="settings.cameraPasswordSet.value ? '••••••••' : ''"
            />
          </div>

          <div class="camera-actions">
            <UiButton size="sm" :disabled="cameraSaving" @click="saveCamera">
              {{ cameraSaving ? "Saving…" : "Save camera" }}
            </UiButton>
            <UiButton
              v-if="settings.cameraUrl.value"
              size="sm"
              variant="ghost"
              :disabled="cameraSaving"
              @click="removeCamera"
            >
              Remove
            </UiButton>
          </div>

          <p v-if="cameraMessage" class="card-foot reset-message" role="status">{{ cameraMessage }}</p>
          <p v-if="cameraError" class="card-foot reset-error" role="alert">{{ cameraError }}</p>
        </div>

        <p class="card-foot">
          The server transcodes the stream to HLS, so it plays in every browser.
          Credentials stay on the server and are never sent back to clients.
        </p>
      </section>

      <!-- ── Indoor temperatures (Nest) ── -->
      <NestSettingsCard />

      <!-- ── Motion ── -->
      <section class="settings-card settings-card--motion">
        <header class="card-header">
          <div class="card-heading">
            <h3 class="card-title">Motion</h3>
            <p class="card-desc">Bouncy animations and transitions across the app</p>
          </div>
        </header>

        <div class="card-body">
          <div class="setting-row">
            <div class="row-copy">
              <p class="row-title">Animations</p>
              <p class="row-desc">Buttons, cards, and panels spring into place</p>
            </div>
            <UiToggle v-model="animationsEnabled" />
          </div>

          <div class="motion-preview" :class="{ 'is-on': animationsEnabled }" aria-hidden="true">
            <span class="motion-block" />
            <span class="motion-block" />
            <span class="motion-block" />
            <span class="motion-block" />
          </div>

          <p v-if="systemReducedMotion" class="card-note motion-locked">
            Your system asks for reduced motion. This switch overrides that for HOMST.
          </p>
        </div>
      </section>

      <!-- ── Home screen ── -->
      <section class="settings-card settings-card--home">
        <header class="card-header">
          <div class="card-heading">
            <h3 class="card-title">Home Screen</h3>
            <p class="card-desc">Screen rotation and the default card arrangement</p>
          </div>
          <UiButton size="sm" variant="ghost" :disabled="resettingLayout" @click="askToResetLayout">
            Reset layout
          </UiButton>
        </header>

        <div class="card-body">
          <div class="setting-row">
            <div class="row-copy">
              <p class="row-title">Rotate screens</p>
              <p class="row-desc">Cycle through Home, Calendar and Tasks while the display is idle</p>
            </div>
            <UiToggle
              :model-value="settings.carouselEnabled.value"
              @update:model-value="(v: boolean) => onScreenToggle('carousel', v)"
            />
          </div>

          <div class="setting-row">
            <div class="row-copy">
              <p class="row-title">Return to Home</p>
              <p class="row-desc">After 15 minutes without interaction, show the Home screen</p>
            </div>
            <UiToggle
              :model-value="settings.returnHomeEnabled.value"
              @update:model-value="(v: boolean) => onScreenToggle('returnHome', v)"
            />
          </div>

          <div
            class="layout-preview"
            role="img"
            aria-label="The default home screen arrangement of eight cards"
          >
            <span
              v-for="card in DEFAULT_LAYOUT"
              :key="card.id"
              class="layout-block"
              :class="`layout-block--${card.id}`"
              :style="{
                gridColumn: `${card.col + 1} / span ${card.w}`,
                gridRow: `${card.row + 1} / span ${card.h}`,
              }"
            />
          </div>

          <div v-if="confirmingLayoutReset" class="confirm-box">
            <PhWarningCircle :size="20" class="confirm-icon" />
            <div class="confirm-copy">
              <p class="confirm-title">Reset the home screen layout?</p>
              <p class="row-desc">All cards will move back to their default positions and sizes.</p>
            </div>
            <div class="confirm-actions">
              <UiButton size="sm" variant="ghost" :disabled="resettingLayout" @click="confirmingLayoutReset = false">
                Cancel
              </UiButton>
              <UiButton size="sm" :disabled="resettingLayout" @click="resetHomeLayout">
                {{ resettingLayout ? "Resetting…" : "Reset" }}
              </UiButton>
            </div>
          </div>

          <p v-if="resetLayoutMessage" class="card-foot reset-message" role="status">{{ resetLayoutMessage }}</p>
          <p v-if="resetLayoutError" class="card-foot reset-error" role="alert">{{ resetLayoutError }}</p>
        </div>
      </section>

      <!-- ── Software update ── -->
      <SoftwareUpdateCard class="settings-card--software" />
    </div>

    <div v-if="searching && matchCount === 0" class="settings-search-empty" role="status">
      <p class="settings-search-empty__title">No settings match “{{ searchQuery.trim() }}”</p>
      <p class="settings-search-empty__hint">
        Try a shorter word like “theme”, “music”, or “camera”.
      </p>
      <UiButton size="sm" variant="ghost" @click="clearSearch">Clear search</UiButton>
    </div>
  </div>
</template>

<style scoped>
.settings-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
}

/* ── Search ──
   A single quiet bar above the cards. It spans the panel, stays at the 48px
   touch floor, and borrows the accent only when focused. */
.settings-search {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 48px;
  margin-bottom: var(--space-4);
  padding: 0 var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bgSurface);
  transition:
    border-color var(--duration-fast),
    box-shadow var(--duration-fast);
}

.settings-search:focus-within {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primaryLight);
}

.settings-search__icon {
  flex-shrink: 0;
  color: var(--color-textMuted);
  transition: color var(--duration-fast);
}

.settings-search:focus-within .settings-search__icon {
  color: var(--color-primary);
}

.settings-search__input {
  flex: 1;
  min-width: 0;
  height: 46px;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-thin);
}

.settings-search__input::placeholder {
  color: var(--color-textMuted);
}

/* The bar's own clear button replaces the browser's. */
.settings-search__input::-webkit-search-cancel-button,
.settings-search__input::-webkit-search-decoration {
  -webkit-appearance: none;
  appearance: none;
}

.settings-search__count {
  flex-shrink: 0;
  font-size: var(--text-label-size);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--color-textSecondary);
}

.settings-search__count:empty {
  display: none;
}

.settings-search__clear {
  position: relative;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  min-width: unset;
  min-height: unset;
  padding: 0;
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  color: var(--color-textSecondary);
  cursor: pointer;
  transition:
    background var(--duration-fast),
    color var(--duration-fast),
    transform 80ms ease;
}

/* 48px fingerprint around the 32px chip. */
.settings-search__clear::after {
  content: "";
  position: absolute;
  inset: -8px;
  border-radius: var(--radius-full);
}

.settings-search__clear:hover {
  background: color-mix(in srgb, var(--color-primary) 24%, var(--color-bgSurface));
  color: var(--color-textPrimary);
}

.settings-search__clear:active {
  transform: scale(0.94);
}

.settings-search__clear:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* Painted through the Highlight API so the cards' DOM stays untouched. */
:global(::highlight(settings-search)) {
  background-color: color-mix(in srgb, var(--color-primary) 42%, transparent);
  color: inherit;
}

/* On a dark surface the accent is light, so marked text flips to ink. */
:global(html.dark ::highlight(settings-search)) {
  background-color: color-mix(in srgb, var(--color-primary) 82%, transparent);
  color: var(--color-textInverse);
}

.settings-search-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-12) var(--space-5);
  text-align: center;
  color: var(--color-textSecondary);
}

.settings-search-empty__title {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  line-height: var(--text-heading-line-height);
  color: var(--color-textPrimary);
}

.settings-search-empty__hint {
  max-width: 48ch;
  font-size: var(--text-label-size);
  line-height: 1.5;
}

/* ── Masonry layout ───────────────────────────────────────────────────────────
   Settings cards have genuinely different heights. A balanced column flow
   keeps their natural rhythm instead of stretching short cards into tall grid
   rows, while DOM order stays the reading order: identity, display, systems.
   Cards never split across columns. */
.settings-masonry {
  column-count: 1;
  column-gap: var(--space-4);
  column-fill: balance;
}

.settings-masonry > .settings-card {
  break-inside: avoid;
  -webkit-column-break-inside: avoid;
  page-break-inside: avoid;
  margin: 0 0 var(--space-4);
}

/* Hidden cards leave the column flow entirely, so the rest rebalance. */
.settings-masonry > .is-filtered-out {
  display: none;
}

@media (min-width: 860px) {
  .settings-masonry {
    column-count: 2;
  }
}

@media (min-width: 1400px) {
  .settings-masonry {
    column-count: 3;
  }

  /* Keep the three columns balanced at wall-display widths: identity and
     display settings lead, systems follow. Without these boundaries the
     column balancer can push the whole system group into the last column. */
  .settings-card--reminders,
  .settings-card--camera {
    break-after: column;
  }
}

/* ── Card shell ── */
.settings-card {
  min-width: 0;
  background: var(--color-bgSurface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* ── Shared card anatomy: header, body, foot ── */
.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.card-heading {
  min-width: 0;
}

.card-title {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  line-height: var(--text-heading-line-height);
  color: var(--color-textPrimary);
}

.card-desc {
  margin-top: 2px;
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textSecondary);
  max-width: 58ch;
}

.card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.card-body--center {
  justify-content: center;
}

.settings-card--textsize .card-body {
  justify-content: space-between;
}

/* Header actions keep their label on one line and never shrink into a stack. */
.settings-card--home .card-header :deep(.ui-btn) {
  flex-shrink: 0;
}

.settings-card--home .card-header :deep(.ui-btn__inner) {
  white-space: nowrap;
}

.card-foot {
  font-size: var(--text-label-size);
  line-height: 1.55;
  color: var(--color-textSecondary);
  max-width: 70ch;
}

.selected-badge {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
  background: color-mix(in srgb, var(--color-primary) 16%, var(--color-bgSurface));
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Option grids ── */
.option-grid {
  display: grid;
  gap: var(--space-3);
}

.option-grid--presets {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.option-grid--appearance {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

/* The appearance picker falls to two columns whenever its own card is narrow,
   not when the viewport is: the bento pairs it with Accent on mid-size screens. */
.settings-card--appearance {
  container-type: inline-size;
}

@container (max-width: 520px) {
  .option-grid--appearance {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .option-grid--presets { grid-template-columns: 1fr; }
}

/* One tile anatomy for both pickers: media on top, label and description below. */
.option-tile {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bgElevated);
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--duration-fast),
    background var(--duration-fast),
    box-shadow var(--duration-fast),
    transform var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.option-tile:hover {
  border-color: var(--color-borderStrong);
  transform: translateY(-1px);
  box-shadow: 0 2px 0 0 var(--shadow-lip), 0 6px 16px -4px var(--shadow-drop);
}

.option-tile:active {
  transform: translateY(0);
}

.option-tile:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
}

.option-tile.active {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 14%, var(--color-bgSurface));
  box-shadow: 0 2px 0 0 var(--shadow-accent-lip), 0 6px 20px -4px var(--shadow-accent-drop);
}

.option-media {
  position: relative;
  display: block;
}

.option-check {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-full);
  background: var(--color-bgSurface);
  color: var(--color-textPrimary);
}

.option-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.preset-label,
.theme-label {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.35;
  color: var(--color-textPrimary);
}

.preset-desc,
.theme-desc {
  font-size: var(--text-label-size);
  line-height: 1.4;
  color: var(--color-textSecondary);
}

/* ── Theme previews ── */
.preset-preview {
  display: flex;
  gap: 5px;
  width: 100%;
  height: 84px;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
}

.preset-preview--futur {
  background: #f3edd6;
  box-shadow: inset 0 0 0 2px #15171c;
  border-radius: 8px;
}

.preset-swatch {
  flex: 1;
  border-radius: 5px;
}

.theme-icon-field {
  display: grid;
  place-items: center;
  height: 84px;
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
  color: var(--color-textSecondary);
}

.theme-icon {
  transition: color var(--duration-fast);
}

.option-tile.active .theme-icon {
  color: var(--color-primary);
}

/* ── Accent colors ── */
.color-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-2);
}

@media (max-width: 420px) {
  .color-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

.color-option {
  min-width: 0;
  min-height: 68px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-1);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  transition:
    background var(--duration-fast),
    border-color var(--duration-fast);
}

.color-option:hover {
  background: var(--color-bgSubtle);
}

.color-option.active {
  border-color: color-mix(in srgb, var(--color-primary) 40%, transparent);
  background: color-mix(in srgb, var(--color-primary) 14%, var(--color-bgSurface));
}

.color-swatch {
  width: 40px;
  height: 40px;
  min-width: unset;
  min-height: unset;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid transparent;
  border-radius: var(--radius-full);
  box-shadow: 0 2px 0 0 var(--shadow-lip), 0 4px 12px -2px var(--shadow-drop),
              inset 0 1px 2px var(--shadow-shine);
  transition:
    transform var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94),
    box-shadow var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.color-option:hover .color-swatch {
  transform: scale(1.06);
}

.color-option.active .color-swatch {
  transform: scale(1.08);
  box-shadow:
    0 3px 0 0 var(--shadow-lip),
    0 8px 24px -2px var(--shadow-drop),
    inset 0 0 0 2px rgba(255, 255, 255, 0.6),
    inset 0 1px 3px rgba(255, 255, 255, 0.65);
}

.color-option:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.color-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-label-size);
  line-height: 1.3;
  color: var(--color-textSecondary);
}

.color-option.active .color-name {
  color: var(--color-textPrimary);
  font-weight: var(--font-weight-medium);
}

.swatch-check {
  color: rgba(255, 255, 255, 0.9);
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
}

/* ── Setting rows ── */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 48px;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.row-copy {
  min-width: 0;
}

.row-title {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.35;
  color: var(--color-textPrimary);
}

.row-desc {
  margin-top: 2px;
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textSecondary);
  max-width: 56ch;
}

/* Sub-option of the row above it (the cover spin follows the cover background). */
.setting-row--nested {
  padding-left: var(--space-6);
}

/* Lyrics timing: two arrow targets around a fixed-width readout. The visual
   buttons stay 34px so they sit quietly beside the switches, while ::after
   gives each one a full 48px fingerprint. */
.setting-row--sync {
  flex-wrap: wrap;
}

.setting-row--sync .row-copy {
  flex: 1 1 200px;
}

.lyric-offset {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.lyric-offset__step {
  position: relative;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  min-width: unset;
  min-height: unset;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bgSurface);
  color: var(--color-textPrimary);
  cursor: pointer;
  transition:
    background var(--duration-fast),
    border-color var(--duration-fast),
    transform 80ms ease;
}

.lyric-offset__step::after {
  content: "";
  position: absolute;
  inset: -7px;
  border-radius: var(--radius-full);
}

.lyric-offset__step:hover {
  background: var(--color-bgSubtle);
  border-color: var(--color-borderStrong);
}

.lyric-offset__step:active {
  transform: translateY(1px) scale(0.96);
}

.lyric-offset__step:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.lyric-offset__step:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}

.lyric-offset__value {
  min-width: 78px;
  text-align: center;
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--color-textPrimary);
}

.lyric-offset__reset {
  position: relative;
  margin-left: 4px;
  min-width: unset;
  min-height: unset;
  padding: 4px 6px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-textMuted);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  cursor: pointer;
}

.lyric-offset__reset::after {
  content: "";
  position: absolute;
  inset: -10px -4px;
}

.lyric-offset__reset:hover {
  color: var(--color-textPrimary);
  background: var(--color-bgSubtle);
}

.lyric-offset__reset:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

@media (max-width: 720px) {
  .setting-row--sync .lyric-offset {
    width: 100%;
    justify-content: flex-start;
  }
}

/* ── Camera ── */
.settings-card--camera .setting-row--stack {
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
}

.camera-input {
  flex: 1;
}

.camera-rotation-select {
  max-width: 12rem;
}

.camera-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

/* ── Inline notes ── */
.card-note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textSecondary);
}

.card-note svg {
  color: var(--color-primary);
  flex-shrink: 0;
  margin-top: 1px;
}

.card-note--danger {
  border-color: color-mix(in srgb, var(--color-danger) 45%, var(--color-border));
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  color: var(--color-danger);
}

.auto-note {
  align-items: center;
}

/* ── Text size ── */
.settings-card--textsize :deep(.segmented-control) {
  display: flex;
  width: 100%;
}

.settings-card--textsize :deep(.segmented-btn) {
  flex: 1;
  min-height: 44px;
  padding-inline: 0;
}

.font-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-1);
  min-height: 112px;
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bgSubtle);
}

.preview-heading {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.3;
  color: var(--color-textPrimary);
}

.preview-body {
  font-size: var(--text-body-size);
  line-height: var(--text-body-line-height);
  color: var(--color-textSecondary);
}

/* ── Reminders ── */
.push-on {
  color: var(--color-primary);
  font-weight: var(--font-weight-medium);
}

.test-panel {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.reminder-results {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.reminder-result {
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textSecondary);
}

.reminder-result strong {
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.reminder-notice {
  padding: var(--space-2) var(--space-3);
  border: 1px solid color-mix(in srgb, var(--color-warning) 45%, var(--color-border));
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-warning) 10%, transparent);
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textSecondary);
}

.reminder-notice strong {
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

/* Override UiSelect's default width:100% — as a row item it overflows the
   card and squeezes the label text. Size it to its widest option instead. */
.setting-row .reminder-default-select {
  width: auto;
  max-width: 100%;
  min-width: 170px;
  flex-shrink: 0;
}

/* On a phone the select needs the full row so the label keeps a readable measure. */
@media (max-width: 560px) {
  .setting-row--stack {
    flex-wrap: wrap;
    align-items: stretch;
  }

  .setting-row--stack .reminder-default-select {
    flex: 1 0 100%;
    width: 100%;
    min-width: 0;
  }
}

/* ── Devices ── */
.download-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-primary) 14%, var(--color-bgSurface));
  color: var(--color-textPrimary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  text-decoration: none;
  white-space: nowrap;
  transition: transform var(--duration-fast);
}

.download-btn:hover { transform: translateY(-1px); }
.download-btn:active { transform: scale(0.96); }

.install-steps {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  list-style: none;
}

.install-step {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

.step-index {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-primary) 16%, var(--color-bgSurface));
  color: var(--color-textPrimary);
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
}

/* ── Motion preview ── */
.motion-preview {
  flex: 1;
  min-height: 124px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bgSubtle);
  overflow: hidden;
}

.motion-block {
  width: 30px;
  height: 34px;
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--color-primary) 55%, var(--color-bgSurface));
  box-shadow: 0 2px 0 0 var(--shadow-lip);
}

.motion-block:nth-child(2) {
  height: 54px;
  background: var(--color-primary);
}

.motion-block:nth-child(3) {
  height: 42px;
  background: color-mix(in srgb, var(--color-primary) 75%, var(--color-bgSurface));
}

.motion-block:nth-child(4) {
  height: 30px;
  background: color-mix(in srgb, var(--color-primary) 45%, var(--color-bgSurface));
}

.motion-preview.is-on .motion-block {
  animation: motion-bob 1.8s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

.motion-preview.is-on .motion-block:nth-child(2) {
  animation-delay: 120ms;
}

.motion-preview.is-on .motion-block:nth-child(3) {
  animation-delay: 240ms;
}

.motion-preview.is-on .motion-block:nth-child(4) {
  animation-delay: 360ms;
}

/* A perpetual animation on a low-power display flickers: hold the demo still. */
:global(html.low-power) .motion-preview.is-on .motion-block {
  animation: none !important;
}

@keyframes motion-bob {
  0%, 100% { transform: translateY(0) scaleY(1); }
  50%      { transform: translateY(-10px) scaleY(1.06); }
}

.motion-locked {
  font-style: italic;
}

/* ── Home layout preview ── */
.layout-preview {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  grid-template-rows: repeat(6, minmax(0, 1fr));
  gap: 4px;
  min-height: 220px;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bgSubtle);
}

.layout-block {
  min-width: 0;
  min-height: 0;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
  background: color-mix(in srgb, var(--color-primary) 18%, var(--color-bgSurface));
}

.layout-block--photos {
  background: color-mix(in srgb, var(--color-primary) 34%, var(--color-bgSurface));
}

.layout-block--calendar,
.layout-block--schedule,
.layout-block--camera {
  background: color-mix(in srgb, var(--color-primary) 26%, var(--color-bgSurface));
}

/* ── Layout reset confirmation ── */
.confirm-box {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bgSubtle);
}

.confirm-icon {
  color: var(--color-warning);
  flex-shrink: 0;
  margin-top: 2px;
}

.confirm-copy {
  flex: 1;
  min-width: 200px;
}

.confirm-title {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.confirm-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}

.reset-message {
  color: var(--color-success);
}

.reset-error {
  color: var(--color-danger);
}
</style>

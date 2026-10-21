<script setup lang="ts">
import { computed, ref, watch, onMounted } from "vue"
import { useSettings, type Theme, type ThemePreset, type AccentColor, type FontSize, accentPalette, accentSets } from "@/composables/useSettings"
import { getAnimationEnabled, setAnimationEnabled } from "@/lib/motion"
import { householdApi } from "@/api/household"
import { notificationsApi } from "@/api/notifications"
import { isServerUnreachable } from "@/api/client"
import { usePush } from "@/composables/usePush"
import {
  SERVER_UNREACHABLE_DETAIL,
  SERVER_UNREACHABLE_TITLE,
  useServerReachability,
} from "@/composables/useServerReachability"
import { REMINDER_OPTIONS, reminderMinutesFromValue } from "@/utils/reminders"
import { PhSun, PhMoon, PhDesktop, PhCheck, PhBell, PhDeviceMobile, PhDownloadSimple } from "@phosphor-icons/vue"
import PageHeader from "@/components/ui/PageHeader.vue"
import UiSegmentedControl from "@/components/ui/UiSegmentedControl.vue"
import UiToggle from "@/components/ui/UiToggle.vue"
import UiButton from "@/components/ui/UiButton.vue"
import UiSelect from "@/components/ui/UiSelect.vue"
import SoftwareUpdateCard from "@/components/settings/SoftwareUpdateCard.vue"

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
  { value: "light",  label: "Light",  icon: PhSun,     desc: "Always light" },
  { value: "dark",   label: "Dark",   icon: PhMoon,    desc: "Always dark"  },
  { value: "system", label: "System", icon: PhDesktop, desc: "Follows OS"   },
]

const futurThemeOptions: typeof defaultThemeOptions = [
  { value: "light",  label: "Day",   icon: PhSun,     desc: "Cream paper" },
  { value: "dark",   label: "Night", icon: PhMoon,    desc: "Deep navy"   },
  { value: "system", label: "Auto",  icon: PhDesktop, desc: "Follows OS"  },
]

const appearanceOptions = computed(() =>
  settings.themePreset.value === "futur" ? futurThemeOptions : defaultThemeOptions
)

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

const accentDescription = computed(() =>
  settings.themePreset.value === "futur"
    ? "Sets the field and action color for the flat palette"
    : "Tints buttons, highlights, and interactive elements"
)

const appearanceDescription = computed(() =>
  settings.themePreset.value === "futur"
    ? "Choose the light for the flat palette"
    : "Choose how the interface looks"
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

const selectedColorName = computed(() => colorNames[settings.accentColor.value] ?? "Custom")

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
  const n = s?.notifications
  if (n) {
    settings.updateHudEnabled(n.hud !== false)
    settings.updateDefaultReminderMinutes(n.defaultReminderMinutes ?? null)
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
</script>

<template>
  <div class="settings-panel">
    <PageHeader title="Settings" />

    <!-- ── Theme ── -->
    <div class="settings-card settings-card--preset">
      <div class="card-header">
        <div>
          <h3 class="card-title">Theme</h3>
          <p class="card-desc">Choose the visual language for this display</p>
        </div>
        <span class="selected-badge">{{ activePreset.label }}</span>
      </div>
      <div class="preset-grid">
        <button
          v-for="preset in themePresets"
          :key="preset.value"
          class="preset-card"
          :class="{ active: settings.themePreset.value === preset.value }"
          :aria-pressed="settings.themePreset.value === preset.value"
          @click="settings.updateThemePreset(preset.value)"
        >
          <span class="preset-preview" :class="`preset-preview--${preset.value}`">
            <span
              v-for="(swatch, i) in preset.swatches"
              :key="i"
              class="preset-swatch"
              :style="{ backgroundColor: swatch }"
            />
          </span>
          <span class="preset-copy">
            <span class="preset-label">{{ preset.label }}</span>
            <span class="preset-desc">{{ preset.desc }}</span>
          </span>
          <PhCheck
            v-if="settings.themePreset.value === preset.value"
            :size="16"
            weight="bold"
            class="preset-check"
          />
        </button>
      </div>
    </div>

    <!-- ── Accent Color ── -->
    <div class="settings-card settings-card--accent">
      <div class="card-header">
        <div>
          <h3 class="card-title">Accent Color</h3>
          <p class="card-desc">{{ accentDescription }}</p>
        </div>
        <span class="selected-badge">{{ selectedColorName }}</span>
      </div>
      <div class="color-grid">
        <button
          v-for="color in colorOptions"
          :key="color.value"
          class="color-swatch"
          :class="{ active: settings.accentColor.value === color.value }"
          :style="{ backgroundColor: color.hex }"
          :aria-label="color.name"
          :title="color.name"
          @click="settings.updateAccentColor(color.value)"
        >
          <PhCheck v-if="settings.accentColor.value === color.value" :size="16" weight="bold" class="swatch-check" />
        </button>
      </div>
    </div>

    <!-- ── Appearance ── -->
    <div class="settings-card settings-card--appearance">
      <div class="card-header">
        <div>
          <h3 class="card-title">Appearance</h3>
          <p class="card-desc">{{ appearanceDescription }}</p>
        </div>
      </div>
      <div class="theme-cards">
        <button
          v-for="opt in appearanceOptions"
          :key="opt.value"
          class="theme-card"
          :class="{ active: settings.theme.value === opt.value }"
          @click="settings.updateTheme(opt.value)"
        >
          <component :is="opt.icon" :size="20" class="theme-icon" />
          <span class="theme-label">{{ opt.label }}</span>
          <span class="theme-desc">{{ opt.desc }}</span>
        </button>
      </div>
      <div class="setting-row">
        <div>
          <p class="row-title">{{ warmTitle }}</p>
          <p class="card-desc">{{ warmDescription }}</p>
        </div>
        <UiToggle
          :model-value="settings.warm.value"
          @update:model-value="settings.updateWarm"
        />
      </div>
    </div>

    <!-- ── Text Size ── -->
    <div class="settings-card settings-card--textsize">
      <div class="card-header">
        <div>
          <h3 class="card-title">Text Size</h3>
          <p class="card-desc">Scales all text across the app</p>
        </div>
      </div>
      <UiSegmentedControl
        :model-value="settings.fontSize.value"
        :options="fontSizeOptions"
        @update:model-value="(v) => settings.updateFontSize(v as FontSize)"
      />
      <div class="font-preview">
        <p class="preview-heading">The quick brown fox</p>
        <p class="preview-body">Jumps over the lazy dog. Plan your day, share your space.</p>
      </div>
    </div>

    <!-- ── Reminders ── -->
    <div class="settings-card settings-card--reminders">
      <div class="card-header">
        <div>
          <h3 class="card-title">Reminders</h3>
          <p class="card-desc">Upcoming events announce themselves before they start</p>
        </div>
        <PhBell :size="18" class="reminder-bell" />
      </div>

      <div class="setting-row">
        <div>
          <p class="row-title">On this display</p>
          <p class="card-desc">A reminder card appears on screen</p>
        </div>
        <UiToggle
          :model-value="settings.hudEnabled.value"
          @update:model-value="onHudToggle"
        />
      </div>

      <div class="setting-row">
        <div>
          <p class="row-title">Phone &amp; browser</p>
          <p class="card-desc">
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
      <p v-if="pushError" class="card-desc push-error">{{ pushError }}</p>
      <p v-else-if="!pushSupported" class="card-desc push-hint">
        Push is unavailable here{{ pushSupportDetail ? ` — ${pushSupportDetail}` : "" }}.
        Open HOMST as an installed app over HTTPS; on iPhone or iPad, add it to your Home Screen first.
      </p>

      <div class="setting-row">
        <div>
          <p class="row-title">Default reminder</p>
          <p class="card-desc">New events start with this reminder time</p>
        </div>
        <UiSelect
          :model-value="defaultReminder"
          class="reminder-default-select"
          @update:model-value="onDefaultReminderChange"
        >
          <option v-for="opt in REMINDER_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </UiSelect>
      </div>

      <div class="reminder-test">
        <div class="reminder-test-actions">
          <UiButton size="sm" :disabled="testing" @click="sendTest">
            <PhDeviceMobile :size="14" />{{ testing ? "Sending…" : "Send test to all clients" }}
          </UiButton>
        </div>
        <div v-if="testResults" class="reminder-results">
          <p v-for="(detail, channel) in testResults" :key="channel" class="reminder-result">
            <strong>{{ CHANNEL_LABELS[channel] ?? channel }}:</strong> {{ detail }}
          </p>
        </div>
        <p v-if="testUnreachable || !serverReachable" class="reminder-notice" role="status">
          <strong>{{ SERVER_UNREACHABLE_TITLE }}.</strong>
          {{ SERVER_UNREACHABLE_DETAIL }}
        </p>
      </div>

      <p class="card-desc reminder-hint">
        Push reminders reach every phone and browser with push turned on —
        no mail account or extra setup needed. The test reaches every open
        screen and every subscribed device.
      </p>
    </div>

    <!-- ── Devices ── -->
    <div class="settings-card settings-card--devices">
      <div class="card-header">
        <div>
          <h3 class="card-title">Add to your devices</h3>
          <p class="card-desc">Install HOMST and turn on notifications on any phone or browser</p>
        </div>
        <PhDeviceMobile :size="18" class="reminder-bell" />
      </div>

      <div class="setting-row">
        <div>
          <p class="row-title">HTTPS certificate</p>
          <p class="card-desc">
            Phones and browsers only allow install and push over a trusted certificate.
            Download it, then install it as a <strong>CA certificate</strong> on each device
            before opening HOMST there.
          </p>
        </div>
        <a class="download-btn" href="/ca.pem" download="homst-ca.pem">
          <PhDownloadSimple :size="14" />Download
        </a>
      </div>
      <p class="card-desc">
        On Android: Settings → Security &amp; privacy → More security settings →
        Encryption &amp; credentials → Install a certificate → <strong>CA certificate</strong>.
      </p>
    </div>

    <!-- ── Motion ── -->
    <div class="settings-card settings-card--motion">
      <div class="card-header">
        <div>
          <h3 class="card-title">Motion</h3>
          <p class="card-desc">Enable bouncy animations and transitions</p>
        </div>
        <UiToggle v-model="animationsEnabled" />
      </div>
      <p v-if="systemReducedMotion" class="card-desc motion-locked">
        Your system asks for reduced motion. This switch overrides that for HOMST.
      </p>
    </div>

    <!-- ── Software update ── -->
    <SoftwareUpdateCard class="settings-card--software" />

  </div>
</template>

<style scoped>
.settings-panel {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 640px);
  justify-content: center;
  align-items: stretch;
  gap: var(--space-4);
}

/* The page title spans the whole bento */
.settings-panel > .page-header {
  grid-column: 1 / -1;
}

/* ── Bento layout ─────────────────────────────────────────────────────────────
   Two columns on mid-size displays, three on wide kiosk screens. Cards fill
   their grid cell; shorter cards spread their content instead of leaving a gap. */
@media (min-width: 1000px) {
  .settings-panel {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    justify-content: stretch;
  }

  .settings-card--preset     { grid-column: 1 / -1; }
  .settings-card--accent     { grid-column: span 2; }
  .settings-card--appearance { grid-column: span 4; }
  .settings-card--textsize   { grid-column: span 2; }
  .settings-card--reminders  { grid-column: span 4; }
  .settings-card--devices    { grid-column: span 4; }
  .settings-card--motion     { grid-column: span 2; }
  .settings-card--software   { grid-column: 1 / -1; }
}

@media (min-width: 1400px) {
  .settings-panel {
    grid-template-columns: repeat(12, minmax(0, 1fr));
  }

  .settings-card--preset     { grid-column: 1 / -1; }
  .settings-card--accent     { grid-column: span 4; }
  .settings-card--appearance { grid-column: span 8; }
  .settings-card--textsize   { grid-column: span 4; }
  .settings-card--reminders  { grid-column: span 8; }
  .settings-card--devices    { grid-column: span 8; }
  .settings-card--motion     { grid-column: span 4; }
  .settings-card--software   { grid-column: 1 / -1; }
}

/* Short cards paired with taller neighbours keep their controls optically centred */
.settings-card--accent .color-grid {
  margin-block: auto;
}

.settings-card--textsize .font-preview {
  margin-block: auto;
}

.settings-card--motion {
  justify-content: center;
}

/* ── Card ── */
.settings-card {
  background: var(--color-bgSurface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.card-title {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.card-desc {
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  margin-top: var(--space-1);
}

/* Segmented controls sit at their natural width instead of stretching across the card */
.settings-card :deep(.segmented-control) {
  align-self: flex-start;
}

.download-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--color-accent-lighter);
  color: var(--color-accent-darker);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  text-decoration: none;
  white-space: nowrap;
  transition: transform var(--duration-fast);
}

.download-btn:hover { transform: translateY(-1px); }
.download-btn:active { transform: scale(0.96); }

.selected-badge {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-primary);
  background: var(--color-accent-lighter);
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Color swatches ── */
.color-grid {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.color-swatch {
  width: 44px;
  height: 44px;
  min-width: unset;
  min-height: unset;
  border: 2px solid transparent;
  border-radius: var(--radius-full);
  cursor: pointer;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94),
              box-shadow var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94);
  box-shadow: 0 2px 0 0 var(--shadow-lip), 0 4px 12px -2px var(--shadow-drop),
              inset 0 1px 2px var(--shadow-shine);
}

.color-swatch:hover { transform: scale(1.1); }
.color-swatch:active { transform: scale(0.92); transition-duration: 60ms; }

.color-swatch.active {
  transform: scale(1.16);
  box-shadow:
    0 3px 0 0 var(--shadow-lip),
    0 8px 24px -2px var(--shadow-drop),
    inset 0 0 0 2px rgba(255,255,255,0.6),
    inset 0 1px 3px rgba(255,255,255,0.65);
}

.swatch-check {
  color: rgba(255, 255, 255, 0.9);
  filter: drop-shadow(0 1px 1px rgba(0,0,0,0.3));
}

/* ── Theme preset cards ── */
.preset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.preset-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bgElevated);
  cursor: pointer;
  min-width: unset;
  min-height: unset;
  position: relative;
  text-align: left;
  transition: border-color var(--duration-fast), background var(--duration-fast),
              box-shadow var(--duration-fast), transform var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.preset-card:hover {
  border-color: var(--color-borderStrong);
  transform: translateY(-1px);
  box-shadow: 0 2px 0 0 var(--shadow-lip), 0 6px 16px -4px var(--shadow-drop);
}

.preset-card:active { transform: translateY(0); }

.preset-card:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
}

.preset-card.active {
  border-color: var(--color-primary);
  background: var(--color-accent-lighter);
  box-shadow: 0 2px 0 0 var(--shadow-accent-lip), 0 6px 20px -4px var(--shadow-accent-drop);
}

.preset-preview {
  display: flex;
  gap: 4px;
  width: 92px;
  height: 56px;
  flex-shrink: 0;
  padding: 7px;
  border-radius: 10px;
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

.preset-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.preset-label {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.preset-desc {
  font-size: var(--text-micro-size);
  color: var(--color-textMuted);
  line-height: 1.3;
}

.preset-check {
  margin-left: auto;
  color: var(--color-primary);
  flex-shrink: 0;
}

@media (max-width: 560px) {
  .preset-grid { grid-template-columns: 1fr; }
  .preset-preview { width: 72px; height: 48px; }
}

/* ── Theme cards ── */
.theme-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-3);
}

.theme-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-3);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bgElevated);
  cursor: pointer;
  min-width: unset;
  min-height: unset;
  transition: border-color var(--duration-fast), background var(--duration-fast),
              box-shadow var(--duration-fast), transform var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.theme-card:hover {
  border-color: var(--color-borderStrong);
  transform: translateY(-1px);
  box-shadow: 0 2px 0 0 var(--shadow-lip), 0 6px 16px -4px var(--shadow-drop);
}

.theme-card:active { transform: translateY(0); }

.theme-card.active {
  border-color: var(--color-primary);
  background: var(--color-accent-lighter);
  box-shadow: 0 2px 0 0 var(--shadow-accent-lip), 0 6px 20px -4px var(--shadow-accent-drop);
}

.theme-icon {
  color: var(--color-textMuted);
  transition: color var(--duration-fast);
}

.theme-card.active .theme-icon {
  color: var(--color-primary);
}

.theme-label {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.theme-desc {
  font-size: var(--text-micro-size);
  color: var(--color-textMuted);
}

/* ── Toggle row ── */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.row-title {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

/* ── Font preview ── */
.font-preview {
  background: var(--color-bgElevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.preview-heading {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
  line-height: 1.3;
}

.preview-body {
  font-size: var(--text-body-size);
  color: var(--color-textSecondary);
  line-height: var(--text-body-line-height);
}

.motion-locked {
  color: var(--color-textMuted);
  font-style: italic;
}

/* ── Reminders ── */
.reminder-bell {
  color: var(--color-textMuted);
  flex-shrink: 0;
}

.reminder-test {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
  align-items: flex-start;
}

.reminder-test-actions {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

/* Override UiSelect's default width:100% — as a row item it overflows the
   card and squeezes the label text. Size it to its widest option instead. */
.setting-row .reminder-default-select {
  width: auto;
  max-width: 100%;
  min-width: 170px;
  flex-shrink: 0;
}

.reminder-results {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.reminder-result {
  font-size: var(--text-label-size);
  color: var(--color-textSecondary);
  line-height: 1.5;
}

.reminder-result strong {
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.reminder-notice {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--color-warning, #caa681);
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--color-warning, #caa681) 12%, transparent);
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  line-height: 1.5;
}

.reminder-notice strong {
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.reminder-hint {
  margin-top: calc(-1 * var(--space-2));
}

.push-on {
  color: var(--color-primary);
  font-weight: var(--font-weight-medium);
}

.push-error {
  color: var(--color-danger, #c0392b);
}

.push-hint {
  margin-top: calc(-1 * var(--space-2));
}

</style>

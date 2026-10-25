<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue"
import { useRoute } from "vue-router"
import { PhCloudSlash } from "@phosphor-icons/vue"
import { useUi } from "@/composables/useUi"
import type { PanelView } from "@/composables/useUi"
import { readHouseholdComplete, writeHouseholdComplete } from "@/lib/householdCache"
import { useSettings, applyHouseholdSettings, isApplyingRemoteSettings } from "@/composables/useSettings"
import { useStream } from "@/composables/useStream"
import { useEvents } from "@/composables/useEvents"
import { useAnnouncements } from "@/composables/useAnnouncements"
import { useNotificationIntent } from "@/composables/useNotificationIntent"
import { useOfflineNotifications } from "@/composables/useOfflineNotifications"
import { useSpotify } from "@/composables/useSpotify"
import { matchStoredPush, type StoredPush } from "@/lib/pushStore"
import {
  markServerUnreachable,
  SERVER_UNREACHABLE_TITLE,
  useServerReachability,
} from "@/composables/useServerReachability"
import { api } from "@/api/client"
import { householdApi } from "@/api/household"
import { photosApi } from "@/api/photos"
import AppNav from "@/components/shared/AppNav.vue"
import AnnouncementBanner from "@/components/shared/AnnouncementBanner.vue"
import HudAlert from "@/components/shared/HudAlert.vue"
import LyricsOverlay from "@/components/shared/LyricsOverlay.vue"
import UpdatePrompt from "@/components/shared/UpdatePrompt.vue"
import SpotifyBackdrop from "@/components/shared/SpotifyBackdrop.vue"
import { animate, ease, springs } from "@/lib/motion"
import HomeView from "@/components/home/HomeView.vue"
import CalendarView from "@/components/calendar/CalendarView.vue"
import KanbanView from "@/components/kanban/KanbanView.vue"
import AnnouncementPanel from "@/components/announcements/AnnouncementPanel.vue"
import SettingsPanel from "@/components/settings/SettingsPanel.vue"
import DrawerOverlay from "@/components/shared/DrawerOverlay.vue"
import MemberDetailPanel from "@/components/profile/MemberDetailPanel.vue"
import EventDetailPanel from "@/components/events/EventDetailPanel.vue"
import TaskDetailPanel from "@/components/tasks/TaskDetailPanel.vue"
import MobileShell from "@/components/mobile/MobileShell.vue"
import MobileOnboardingGate from "@/components/mobile/MobileOnboardingGate.vue"
import OfflineNotifications from "@/components/shared/OfflineNotifications.vue"

const route = useRoute()
const ui = useUi()
const settings = useSettings()
const { status: streamStatus } = useStream()
const { prefetchAround } = useEvents()
const { ensureLoaded: ensureAnnouncementsLoaded } = useAnnouncements()
const { take: takeNotificationIntent } = useNotificationIntent()
const { serverReachable, checkServerReachable } = useServerReachability()
const { items: offlineNotifications, load: loadOfflineNotifications } = useOfflineNotifications()
const { init: initSpotify } = useSpotify()
const sheetOpen = computed(() => ui.announcementsOpen.value || ui.isDrawerOpen.value)

// Consume the deep link once, before the router or a reload can drop it.
const notificationIntent = takeNotificationIntent()

const isMobile = computed(() => /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent))
const householdComplete = ref(readHouseholdComplete())
const offlineSheetOpen = ref(false)
const offlineSelected = ref<StoredPush | null>(null)
const offlineCardPinned = ref(false)
let notificationIntentHandled = false

function onMobileJoined() {
  householdComplete.value = true
  writeHouseholdComplete(true)
}

const PAGE_CYCLE: PanelView[] = ["home", "calendar", "tasks"]
const IDLE_MS = 30_000
let cycleTimer: ReturnType<typeof setTimeout> | null = null
let lastInteraction = Date.now()
let moveTimer: ReturnType<typeof setTimeout> | null = null

function schedulePageCycle() {
  const delay = 120_000
  cycleTimer = setTimeout(() => {
    if (ui.isDrawerOpen.value || Date.now() - lastInteraction < IDLE_MS) {
      schedulePageCycle()
      return
    }
    const idx = PAGE_CYCLE.indexOf(ui.activePanel.value as typeof PAGE_CYCLE[number])
    const next = PAGE_CYCLE[(idx + 1) % PAGE_CYCLE.length]
    ui.setPanel(next)
    schedulePageCycle()
  }, delay)
}

function resetIdleTimer() {
  lastInteraction = Date.now()
}

function onMouseMove() {
  if (moveTimer !== null) return
  moveTimer = setTimeout(() => {
    moveTimer = null
    lastInteraction = Date.now()
  }, 300)
}

function onOnline() {
  void checkServerReachable()
}

function onOffline() {
  markServerUnreachable()
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") void checkServerReachable()
}

/**
 * Show the copy of a push payload that the service worker stored on this
 * device. Used when the tap's deep link cannot load because the household
 * server is unreachable (away from the LAN, without a VPN).
 */
async function openOfflineNotification(intent = notificationIntent) {
  offlineCardPinned.value = false
  const rows = await loadOfflineNotifications(true)
  offlineSelected.value = matchStoredPush(rows, intent) ?? rows[0] ?? null
  offlineSheetOpen.value = true
}

onMounted(() => {
  if (!isMobile.value) {
    schedulePageCycle()
    window.addEventListener("pointerdown", resetIdleTimer)
    window.addEventListener("keydown", resetIdleTimer)
    window.addEventListener("wheel", resetIdleTimer)
    window.addEventListener("mousemove", onMouseMove)
  }
  void loadOfflineNotifications()
  // A cached PWA can open while the LAN (or VPN) is out of reach. Probe once
  // on launch so the shell can explain why writes will fail.
  void checkServerReachable().then((reachable) => {
    if (reachable) return
    appReady.value = true
    // A notification tap should still show its text instead of a blank app.
    void openNotificationIntent()
  })
  window.addEventListener("online", onOnline)
  window.addEventListener("offline", onOffline)
  document.addEventListener("visibilitychange", onVisibilityChange)
})

watch(serverReachable, (reachable) => {
  if (reachable) {
    offlineCardPinned.value = false
    return
  }
  // Pick up pushes that arrived while the app was open so the banner can
  // offer them without a reload.
  void loadOfflineNotifications(true)
})

onUnmounted(() => {
  if (cycleTimer !== null) clearTimeout(cycleTimer)
  if (moveTimer !== null) clearTimeout(moveTimer)
  window.removeEventListener("pointerdown", resetIdleTimer)
  window.removeEventListener("keydown", resetIdleTimer)
  window.removeEventListener("wheel", resetIdleTimer)
  window.removeEventListener("mousemove", onMouseMove)
  window.removeEventListener("online", onOnline)
  window.removeEventListener("offline", onOffline)
  document.removeEventListener("visibilitychange", onVisibilityChange)
})

// Sync settings to backend when they change
let syncTimer: ReturnType<typeof setTimeout>
if (!isMobile.value) {
  watch([
    () => settings.theme.value,
    () => settings.themePreset.value,
    () => settings.accentColor.value,
    () => settings.fontSize.value,
    () => settings.warm.value,
  ], () => {
    // Settings applied from the server (initial load, resync, SSE broadcast)
    // must never be echoed back — only local edits persist.
    if (isApplyingRemoteSettings()) return
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      api.patch("/household/settings", {
        settings: {
          theme: settings.theme.value,
          themePreset: settings.themePreset.value,
          accentColor: settings.accentColor.value,
          fontSize: settings.fontSize.value,
          warm: settings.warm.value,
        }
      }).catch(() => {})
    }, 500)
  })
}

/**
 * A Web Push tap opens the app with `?event=…` or `?announcement=…`.
 * Load the data that the destination needs, then open the matching sheet or
 * panel. The query is consumed once so a reload does not reopen it.
 */
async function openNotificationIntent() {
  const intent = notificationIntent
  if (!intent || notificationIntentHandled) return
  notificationIntentHandled = true

  if (!serverReachable.value) {
    await openOfflineNotification(intent)
    return
  }

  // A plain push (for example the settings test) has no destination view.
  if (intent.type === "push") return

  if (intent.type === "event") {
    const parsed = intent.startAt ? new Date(Number(intent.startAt) * 1000) : new Date()
    const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed
    await prefetchAround(date.getFullYear(), date.getMonth())
    ui.setPanel("calendar")
    ui.openDrawer("event-detail", intent.id)
    return
  }

  await ensureAnnouncementsLoaded()
  if (isMobile.value) ui.openAnnouncements()
  else ui.setPanel("announcements")
}

const isOnboarding = computed(() => route.path === "/onboarding")

const prefersDark = ref(window.matchMedia("(prefers-color-scheme: dark)").matches)
const mq = window.matchMedia("(prefers-color-scheme: dark)")
function onMqChange(e: MediaQueryListEvent) { prefersDark.value = e.matches }
if (!isMobile.value) {
  onMounted(() => mq.addEventListener("change", onMqChange))
  onUnmounted(() => mq.removeEventListener("change", onMqChange))
}

const isDark = computed(() => {
  if (settings.theme.value === "dark") return true
  if (settings.theme.value === "light") return false
  if (settings.theme.value === "auto") {
    // The server resolves sunrise/sunset for the household. Until that state
    // arrives, follow the OS so the first paint is sensible.
    return settings.autoThemeDark.value ?? prefersDark.value
  }
  return prefersDark.value
})

const views: Record<string, typeof CalendarView> = {
  home:          HomeView,
  calendar:      CalendarView,
  tasks:         KanbanView,
  announcements: AnnouncementPanel,
  settings:      SettingsPanel,
}

const themeReady = ref(false)
const themeTransitioning = ref(false)
let themeTimer: ReturnType<typeof setTimeout>
const appReady = ref(false)

onMounted(() => {
  requestAnimationFrame(() => { themeReady.value = true })
  // Kicked off here (guarded internally) so the now-playing backdrop works on
  // every panel, not only after the home screen has mounted.
  void initSpotify()
  householdApi.getSettings()
    .then(s => {
      householdComplete.value = s.isComplete ?? false
      writeHouseholdComplete(householdComplete.value)
      applyHouseholdSettings(s)
      // Remember the household's timezone once — the reminders worker uses it
      // to write "7:30 AM" into push reminders.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (!s.timezone && tz) {
        api.patch("/household/settings", { settings: { timezone: tz } }).catch(() => {})
      }
    })
    .catch(() => {})
    .finally(() => {
      photosApi.list().then(photos => { settings.photos.value = Array.isArray(photos) ? photos : [] }).catch(() => {})
      appReady.value = true
      void openNotificationIntent()
    })
})

watch(isDark, (dark) => {
  document.documentElement.classList.toggle("dark", dark)
  settings.applyAccentToDOM(settings.accentColor.value)
  themeTransitioning.value = true
  clearTimeout(themeTimer)
  themeTimer = setTimeout(() => { themeTransitioning.value = false }, 400)
}, { immediate: true })

watch(() => settings.warm.value, (warm) => {
  document.documentElement.classList.toggle("warm", warm)
  themeTransitioning.value = true
  clearTimeout(themeTimer)
  themeTimer = setTimeout(() => { themeTransitioning.value = false }, 400)
}, { immediate: true })

watch(() => settings.themePreset.value, () => {
  // The class itself is applied by useSettings; this only softens the swap.
  themeTransitioning.value = true
  clearTimeout(themeTimer)
  themeTimer = setTimeout(() => { themeTransitioning.value = false }, 400)
}, { immediate: true })

watch(() => settings.fontSize.value, (size) => {
  settings.applyFontSizeToDOM(size)
}, { immediate: true })

function panelEnter(el: Element, done: () => void) {
  animate(el, {
    opacity: [0, 1],
    scale: [0.96, 1],
    translateY: [14, 0],
    ease: springs.enter,
    onComplete: done,
  })
}

function panelLeave(el: Element, done: () => void) {
  animate(el, {
    opacity: 0,
    scale: 0.97,
    duration: 120,
    ease: ease.in,
    onComplete: done,
  })
}
</script>

<template>
  <!-- Full-bleed spinning record behind the app while Spotify is playing -->
  <SpotifyBackdrop v-if="!isOnboarding" />

  <!-- App-level loading spinner -->
  <div v-if="!appReady" class="app-loader">
    <div class="app-spinner" />
  </div>

  <!-- MOBILE branch -->
  <template v-if="isMobile && appReady">
    <MobileOnboardingGate v-if="!householdComplete" @joined="onMobileJoined" />
    <MobileShell v-else />

    <!-- Household announcements appear above both shells -->
    <AnnouncementBanner :display="false" />
  </template>

  <!-- DESKTOP branch (identical to original template) -->
  <template v-else-if="!isMobile">
    <div v-if="isOnboarding" class="onboarding-root">
      <router-view />
    </div>
    <div v-else class="app-root" :class="{
      'theme-ready': themeReady,
      'theme-transitioning': themeTransitioning,
    }">
      <div class="app-body">
        <AppNav />
        <main class="main-panel">
          <Transition mode="out-in" :css="false" @enter="panelEnter" @leave="panelLeave">
            <component :is="views[ui.activePanel.value]" :key="ui.activePanel.value" />
          </Transition>
        </main>
      </div>
      <DrawerOverlay>
        <MemberDetailPanel v-if="ui.drawer.value.type === 'member-detail'" />
        <EventDetailPanel v-else-if="ui.drawer.value.type === 'event-detail'" />
        <TaskDetailPanel v-else-if="ui.drawer.value.type === 'task-detail'" />
      </DrawerOverlay>

      <!-- Household announcements from any screen -->
      <AnnouncementBanner :display="true" />

      <!-- Reminder heads-up display (kiosk) -->
      <HudAlert :display="true" />

      <!-- Two lines of synced lyrics while Spotify plays -->
      <LyricsOverlay />

      <!-- New-version prompt (display clients only) -->
      <UpdatePrompt />

      <!-- Connection status indicator -->
      <div v-if="serverReachable" class="stream-status" :class="streamStatus" :title="streamStatus === 'connected' ? 'Live' : streamStatus === 'connecting' ? 'Connecting...' : 'Disconnected'">
        <span class="stream-dot" />
      </div>
    </div>
  </template>

  <!-- Fallback: should never reach, but prevents blank page -->
  <div v-else class="app-root">
    <div class="app-body">
      <main class="main-panel">
        <router-view />
      </main>
    </div>
  </div>

  <!-- Web Push is one-way; writes still need a route back to the household.
       Collapsed to the top-right dot, the explanation appears on hover or focus. -->
  <div
    v-if="!serverReachable && !offlineSheetOpen && !sheetOpen"
    class="server-offline"
    :class="{ 'server-offline--pinned': offlineCardPinned }"
  >
    <button
      class="server-offline__trigger"
      type="button"
      :aria-expanded="offlineCardPinned"
      :aria-label="`${SERVER_UNREACHABLE_TITLE}. Show details`"
      @click="offlineCardPinned = !offlineCardPinned"
    >
      <span class="server-offline__dot" aria-hidden="true" />
    </button>

    <div class="server-offline__card" role="status" aria-live="polite">
      <div class="server-offline__head">
        <span class="server-offline__badge" aria-hidden="true">
          <PhCloudSlash :size="15" weight="bold" />
        </span>
        <p class="server-offline__eyebrow">Offline</p>
      </div>
      <p class="server-offline__title">{{ SERVER_UNREACHABLE_TITLE }}</p>
      <button
        v-if="offlineNotifications.length"
        class="server-offline__action"
        type="button"
        @click="openOfflineNotification()"
      >
        Read notifications
      </button>
    </div>
  </div>

  <!-- The service worker keeps a copy of each push so it is readable offline. -->
  <OfflineNotifications
    v-if="offlineSheetOpen"
    :items="offlineNotifications"
    :selected="offlineSelected"
    @close="offlineSheetOpen = false"
  />
</template>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--color-textPrimary);
  background-color: var(--color-bgBase);
  /* Sits above the SpotifyBackdrop (z-index 0) when a record is on. */
  position: relative;
  z-index: 1;
}

.onboarding-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--color-textPrimary);
  background-color: var(--color-bgBase);
  position: relative;
  z-index: 1;
}

.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.main-panel {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--space-4);
  background-color: var(--color-bgSubtle);
}

/* Keep the darker panel tint to light mode only */
:global(.dark) .main-panel {
  background-color: var(--color-bgBase);
}

/* ── Stream connection indicator ── */
.stream-status {
  position: fixed;
  top: 9px;
  right: 9px;
  z-index: 300;
}

.stream-dot {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  transition: background var(--duration-fast);
}

.stream-status.connected .stream-dot { background: var(--color-success,#8e9277); }
.stream-status.connecting .stream-dot { background: var(--color-warning,#caa681); animation: pulse 1s ease-in-out infinite; }
.stream-status.disconnected .stream-dot { background: var(--color-danger,#a87781); }

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

/* ── Local server unreachable notice ──
   Collapsed to a single dot in the top-right corner. The explanation only
   appears while the dot is hovered, focused, or tapped. */
.server-offline {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 300;
  display: flex;
  justify-content: flex-end;
  font-family: var(--font-family);
}

.server-offline__trigger {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  cursor: pointer;
}

.server-offline__dot {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  background: var(--color-danger, #a87781);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-danger, #a87781) 24%, transparent);
  transition:
    transform var(--duration-fast) ease,
    box-shadow var(--duration-fast) ease;
}

.server-offline:hover .server-offline__dot,
.server-offline__trigger:focus-visible .server-offline__dot,
.server-offline--pinned .server-offline__dot {
  transform: scale(1.2);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--color-danger, #a87781) 32%, transparent);
}

.server-offline__trigger:focus-visible {
  outline: 2px solid var(--color-accent-darker);
  outline-offset: 2px;
}

.server-offline__card {
  position: absolute;
  top: 100%;
  right: var(--space-1);
  display: flex;
  flex-direction: column;
  width: min(340px, calc(100vw - var(--space-4)));
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bgElevated);
  box-shadow:
    0 18px 44px -20px rgba(0, 0, 0, 0.5),
    0 2px 6px -2px rgba(0, 0, 0, 0.12);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-6px);
  pointer-events: none;
  transition:
    opacity var(--duration-fast) ease,
    transform var(--duration-fast) ease,
    visibility var(--duration-fast) linear;
}

.server-offline:hover .server-offline__card,
.server-offline:focus-within .server-offline__card,
.server-offline--pinned .server-offline__card {
  opacity: 1;
  visibility: visible;
  transform: none;
  pointer-events: auto;
}

.server-offline__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.server-offline__badge {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-danger, #a87781) 16%, transparent);
  color: color-mix(in srgb, var(--color-danger, #a87781) 55%, var(--color-textPrimary));
}

.server-offline__eyebrow {
  margin: 0;
  font-size: var(--text-micro-size);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-textMuted);
}

.server-offline__title {
  margin: var(--space-2) 0 0;
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.35;
  color: var(--color-textPrimary);
}

.server-offline__action {
  margin-top: var(--space-3);
  min-height: 40px;
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-accent-lighter);
  color: var(--color-accent-darker);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.server-offline__action:active {
  background: var(--color-accent-light);
}

.server-offline__action:focus-visible {
  outline: 2px solid var(--color-accent-darker);
  outline-offset: 2px;
}

/* Phones have no hover: keep the explanation visible above the tab bar. */
@media (max-width: 640px) {
  .server-offline {
    top: auto;
    right: auto;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 92px);
    width: calc(100% - 2rem);
    max-width: 460px;
    padding: 0;
    transform: translateX(-50%);
  }

  .server-offline__trigger {
    display: none;
  }

  .server-offline__card {
    position: static;
    width: 100%;
    opacity: 1;
    visibility: visible;
    transform: none;
    pointer-events: auto;
  }
}

/* ── App loading spinner ── */
.app-loader {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bgBase);
}

.app-spinner {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 3px solid var(--color-accent-lighter);
  border-top-color: var(--color-accent-base);
  animation: app-spin 0.7s linear infinite;
}

@keyframes app-spin { to { transform: rotate(360deg); } }
</style>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent, h, type Component } from "vue"
import { useRoute } from "vue-router"
import { PhCloudSlash } from "@phosphor-icons/vue"
import { useUi } from "@/composables/useUi"
import type { PanelView } from "@/composables/useUi"
import { readHouseholdComplete, writeHouseholdComplete } from "@/lib/householdCache"
import { useSettings, isApplyingRemoteSettings, accentPalette } from "@/composables/useSettings"
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
import AppNav from "@/components/shared/AppNav.vue"
import AnnouncementBanner from "@/components/shared/AnnouncementBanner.vue"
import HudAlert from "@/components/shared/HudAlert.vue"
import LyricsOverlay from "@/components/shared/LyricsOverlay.vue"
import UpdatePrompt from "@/components/shared/UpdatePrompt.vue"
import SpotifyBackdrop from "@/components/shared/SpotifyBackdrop.vue"
import UiLoader from "@/components/ui/UiLoader.vue"
import { animate, ease, springs, isCheapCompositor } from "@/lib/motion"
import HomeView from "@/components/home/HomeView.vue"
import DrawerOverlay from "@/components/shared/DrawerOverlay.vue"
import MemberDetailPanel from "@/components/profile/MemberDetailPanel.vue"
import EventDetailPanel from "@/components/events/EventDetailPanel.vue"
import TaskDetailPanel from "@/components/tasks/TaskDetailPanel.vue"
import MobileShell from "@/components/mobile/MobileShell.vue"
import MobileOnboardingGate from "@/components/mobile/MobileOnboardingGate.vue"
import OfflineNotifications from "@/components/shared/OfflineNotifications.vue"
import { panelLoaders, prefetchPanels } from "@/lib/panelPrefetch"
import { scheduleIdle } from "@/lib/idle"
import { loadHousehold } from "@/lib/hydrate"

const PanelFallback: Component = () => h("div", { class: "panel-fallback", role: "status" }, [h(UiLoader, { size: "lg" })])
const asyncPanel = (loader: () => Promise<Component>) =>
  defineAsyncComponent({ loader, loadingComponent: PanelFallback, delay: 0 })
const CalendarView = asyncPanel(panelLoaders.calendar)
const KanbanView = asyncPanel(panelLoaders.tasks)
const AnnouncementPanel = asyncPanel(panelLoaders.announcements)
const SettingsPanel = asyncPanel(panelLoaders.settings)

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
const PAGE_CYCLE_MS = 120_000
const IDLE_MS = 30_000
const RETURN_HOME_MS = 15 * 60_000
let cycleTimer: ReturnType<typeof setTimeout> | null = null
let homeTimer: ReturnType<typeof setTimeout> | null = null
let lastInteraction = Date.now()
let moveTimer: ReturnType<typeof setTimeout> | null = null

function clearPageCycle() {
  if (cycleTimer !== null) {
    clearTimeout(cycleTimer)
    cycleTimer = null
  }
}

function schedulePageCycle() {
  clearPageCycle()
  if (isMobile.value || !settings.carouselEnabled.value) return
  cycleTimer = setTimeout(() => {
    cycleTimer = null
    if (!settings.carouselEnabled.value) return
    if (ui.isDrawerOpen.value || Date.now() - lastInteraction < IDLE_MS) {
      schedulePageCycle()
      return
    }
    const idx = PAGE_CYCLE.indexOf(ui.activePanel.value as typeof PAGE_CYCLE[number])
    const next = PAGE_CYCLE[(idx + 1) % PAGE_CYCLE.length]
    ui.setPanel(next)
    schedulePageCycle()
  }, PAGE_CYCLE_MS)
}

function clearReturnHome() {
  if (homeTimer !== null) {
    clearTimeout(homeTimer)
    homeTimer = null
  }
}

function scheduleReturnHome() {
  clearReturnHome()
  if (isMobile.value || !settings.returnHomeEnabled.value) return
  homeTimer = setTimeout(() => {
    homeTimer = null
    if (!settings.returnHomeEnabled.value) return
    if (ui.isDrawerOpen.value) {
      scheduleReturnHome()
      return
    }
    if (ui.activePanel.value !== "home") ui.setPanel("home")
    scheduleReturnHome()
  }, RETURN_HOME_MS)
}

function resetIdleTimer() {
  lastInteraction = Date.now()
  scheduleReturnHome()
}

function onMouseMove() {
  if (moveTimer !== null) return
  moveTimer = setTimeout(() => {
    moveTimer = null
    lastInteraction = Date.now()
    scheduleReturnHome()
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

async function openOfflineNotification(intent = notificationIntent) {
  offlineCardPinned.value = false
  const rows = await loadOfflineNotifications(true)
  offlineSelected.value = matchStoredPush(rows, intent) ?? rows[0] ?? null
  offlineSheetOpen.value = true
}

onMounted(() => {
  if (!isMobile.value) {
    schedulePageCycle()
    scheduleReturnHome()
    window.addEventListener("pointerdown", resetIdleTimer)
    window.addEventListener("keydown", resetIdleTimer)
    window.addEventListener("wheel", resetIdleTimer)
    window.addEventListener("mousemove", onMouseMove)
  }
  void loadOfflineNotifications()
  window.addEventListener("online", onOnline)
  window.addEventListener("offline", onOffline)
  document.addEventListener("visibilitychange", onVisibilityChange)
})

watch(serverReachable, (reachable) => {
  if (reachable) {
    offlineCardPinned.value = false
    return
  }
  void loadOfflineNotifications(true)
})

onUnmounted(() => {
  clearPageCycle()
  clearReturnHome()
  if (moveTimer !== null) clearTimeout(moveTimer)
  window.removeEventListener("pointerdown", resetIdleTimer)
  window.removeEventListener("keydown", resetIdleTimer)
  window.removeEventListener("wheel", resetIdleTimer)
  window.removeEventListener("mousemove", onMouseMove)
  window.removeEventListener("online", onOnline)
  window.removeEventListener("offline", onOffline)
  document.removeEventListener("visibilitychange", onVisibilityChange)
})

watch(() => settings.carouselEnabled.value, schedulePageCycle)
watch(() => settings.returnHomeEnabled.value, scheduleReturnHome)

let syncTimer: ReturnType<typeof setTimeout>
if (!isMobile.value) {
  watch([
    () => settings.theme.value,
    () => settings.themePreset.value,
    () => settings.accentColor.value,
    () => settings.fontSize.value,
    () => settings.warm.value,
  ], () => {
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

async function openNotificationIntent() {
  const intent = notificationIntent
  if (!intent || notificationIntentHandled) return
  notificationIntentHandled = true

  if (!serverReachable.value) {
    await openOfflineNotification(intent)
    return
  }

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
    return settings.autoThemeDark.value ?? prefersDark.value
  }
  return prefersDark.value
})

const views: Record<string, Component> = {
  home:          HomeView,
  calendar:      CalendarView,
  tasks:         KanbanView,
  announcements: AnnouncementPanel,
  settings:      SettingsPanel,
}

const THEME_DARK_KEY = "homst-theme-dark"
const THEME_PRESET_KEY = "homst-theme-preset"
const THEME_WARM_KEY = "homst-theme-warm"
const THEME_ACCENT_KEY = "homst-theme-accent"

function cacheThemeFlags() {
  try {
    localStorage.setItem(THEME_DARK_KEY, String(isDark.value))
    localStorage.setItem(THEME_PRESET_KEY, settings.themePreset.value)
    localStorage.setItem(THEME_WARM_KEY, String(settings.warm.value))
  } catch {}
}

function cacheAccent(color: keyof typeof accentPalette) {
  const p = accentPalette[color]
  if (!p) return
  const darkHover = p.onAccent === "#fffdf4" || p.onAccent === "#fafafa"
  try {
    localStorage.setItem(THEME_ACCENT_KEY, JSON.stringify({
      base: p.base,
      light: p.light,
      lighter: p.lighter,
      dark: p.dark,
      darker: p.darker,
      onAccent: p.onAccent,
      actionHover: darkHover ? p.dark : p.light,
    }))
  } catch {}
}

function syncThemeColor() {
  if (typeof document === "undefined") return
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-bgBase").trim()
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (bg && meta) meta.content = bg
}

const themeReady = ref(false)
const themeTransitioning = ref(false)
let themeTimer: ReturnType<typeof setTimeout>
const appReady = ref(false)
let readyFallback: ReturnType<typeof setTimeout> | null = null

const isTestEnv = (import.meta as any).env?.MODE === "test"
let cancelPrefetch: (() => void) | null = null

onMounted(() => {
  requestAnimationFrame(() => { themeReady.value = true })
  readyFallback = setTimeout(() => { appReady.value = true }, 2000)
  if (!isTestEnv) cancelPrefetch = scheduleIdle(prefetchPanels)
  void initSpotify()
  loadHousehold()
    .then(s => {
      householdComplete.value = s.settings.isComplete ?? false
      writeHouseholdComplete(householdComplete.value)
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (!s.settings.timezone && tz) {
        api.patch("/household/settings", { settings: { timezone: tz } }).catch(() => {})
      }
    })
    .catch(() => {})
    .finally(() => {
      if (readyFallback !== null) {
        clearTimeout(readyFallback)
        readyFallback = null
      }
      appReady.value = true
      void openNotificationIntent()
    })
})

onUnmounted(() => {
  if (readyFallback !== null) {
    clearTimeout(readyFallback)
    readyFallback = null
  }
  cancelPrefetch?.()
  cancelPrefetch = null
})

watch(isDark, (dark) => {
  document.documentElement.classList.toggle("dark", dark)
  settings.applyAccentToDOM(settings.accentColor.value)
  cacheThemeFlags()
  cacheAccent(settings.accentColor.value)
  syncThemeColor()
  themeTransitioning.value = true
  clearTimeout(themeTimer)
  themeTimer = setTimeout(() => { themeTransitioning.value = false }, 400)
}, { immediate: true })

watch(() => settings.warm.value, (warm) => {
  document.documentElement.classList.toggle("warm", warm)
  cacheThemeFlags()
  syncThemeColor()
  themeTransitioning.value = true
  clearTimeout(themeTimer)
  themeTimer = setTimeout(() => { themeTransitioning.value = false }, 400)
}, { immediate: true })

watch(() => settings.themePreset.value, () => {
  cacheThemeFlags()
  syncThemeColor()
  themeTransitioning.value = true
  clearTimeout(themeTimer)
  themeTimer = setTimeout(() => { themeTransitioning.value = false }, 400)
}, { immediate: true })

watch(() => settings.fontSize.value, (size) => {
  settings.applyFontSizeToDOM(size)
}, { immediate: true })

watch(() => settings.accentColor.value, (color) => cacheAccent(color), { immediate: true })

const cheapMotion = isCheapCompositor()

function panelEnter(el: Element, done: () => void) {
  if (cheapMotion) return
  animate(el, {
    opacity: [0, 1],
    scale: [0.98, 1],
    translateY: [10, 0],
    ease: springs.overlay,
    onComplete: done,
  })
}

function panelLeave(el: Element, done: () => void) {
  if (cheapMotion) return
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
  <SpotifyBackdrop v-if="!isOnboarding" />

  <div v-if="!appReady" class="app-loader" role="status" aria-live="polite">
    <div class="app-spinner" aria-hidden="true" />
    <p class="app-loader__label">Loading your home…</p>
  </div>

  <template v-if="isMobile && appReady">
    <MobileOnboardingGate v-if="!householdComplete" @joined="onMobileJoined" />
    <MobileShell v-else />

    <AnnouncementBanner :display="false" />
  </template>

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
          <Transition
            mode="out-in"
            :css="cheapMotion"
            :name="cheapMotion ? 'panel-fade' : undefined"
            @enter="panelEnter"
            @leave="panelLeave"
          >
            <component :is="views[ui.activePanel.value]" :key="ui.activePanel.value" />
          </Transition>
        </main>
      </div>
      <DrawerOverlay>
        <MemberDetailPanel v-if="ui.drawer.value.type === 'member-detail'" />
        <EventDetailPanel v-else-if="ui.drawer.value.type === 'event-detail'" />
        <TaskDetailPanel v-else-if="ui.drawer.value.type === 'task-detail'" />
      </DrawerOverlay>

      <AnnouncementBanner :display="true" />

      <HudAlert :display="true" />

      <LyricsOverlay />

      <UpdatePrompt />

      <div v-if="serverReachable" class="stream-status" :class="streamStatus" :title="streamStatus === 'connected' ? 'Live' : streamStatus === 'connecting' ? 'Connecting...' : 'Disconnected'">
        <span class="stream-dot" />
      </div>
    </div>
  </template>

  <div v-else class="app-root">
    <div class="app-body">
      <main class="main-panel">
        <router-view />
      </main>
    </div>
  </div>

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

:global(.dark) .main-panel {
  background-color: var(--color-bgBase);
}

:global(.panel-fade-enter-active) {
  transition: opacity 140ms linear;
  will-change: opacity;
}

:global(.panel-fade-leave-active) {
  transition: none;
}

:global(.panel-fade-enter-from),
:global(.panel-fade-leave-to) {
  opacity: 0;
}

.panel-fallback {
  display: grid;
  place-items: center;
  height: 100%;
  min-height: 240px;
}

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

.app-loader {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  background: var(--color-bgBase);
}

.app-loader__label {
  font-size: var(--text-label-size);
  letter-spacing: 0.06em;
  color: var(--color-textSecondary);
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

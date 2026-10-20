<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue"
import { useRoute } from "vue-router"
import { useUi } from "@/composables/useUi"
import type { PanelView } from "@/composables/useUi"
import { useSettings, applyHouseholdSettings, isApplyingRemoteSettings } from "@/composables/useSettings"
import { useStream } from "@/composables/useStream"
import { api } from "@/api/client"
import { householdApi } from "@/api/household"
import { photosApi } from "@/api/photos"
import AppNav from "@/components/shared/AppNav.vue"
import HudAlert from "@/components/shared/HudAlert.vue"
import UpdatePrompt from "@/components/shared/UpdatePrompt.vue"
import { animate, ease, springs } from "@/lib/motion"
import HomeView from "@/components/home/HomeView.vue"
import CalendarView from "@/components/calendar/CalendarView.vue"
import KanbanView from "@/components/kanban/KanbanView.vue"
import SettingsPanel from "@/components/settings/SettingsPanel.vue"
import DrawerOverlay from "@/components/shared/DrawerOverlay.vue"
import MemberDetailPanel from "@/components/profile/MemberDetailPanel.vue"
import EventDetailPanel from "@/components/events/EventDetailPanel.vue"
import TaskDetailPanel from "@/components/tasks/TaskDetailPanel.vue"
import MobileShell from "@/components/mobile/MobileShell.vue"
import MobileOnboardingGate from "@/components/mobile/MobileOnboardingGate.vue"

const route = useRoute()
const ui = useUi()
const settings = useSettings()
const { status: streamStatus } = useStream()

const isMobile = computed(() => /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent))
const householdComplete = ref(false)

function onMobileJoined() {
  householdComplete.value = true
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

onMounted(() => {
  if (!isMobile.value) {
    schedulePageCycle()
    window.addEventListener("pointerdown", resetIdleTimer)
    window.addEventListener("keydown", resetIdleTimer)
    window.addEventListener("wheel", resetIdleTimer)
    window.addEventListener("mousemove", onMouseMove)
  }
})

onUnmounted(() => {
  if (cycleTimer !== null) clearTimeout(cycleTimer)
  if (moveTimer !== null) clearTimeout(moveTimer)
  window.removeEventListener("pointerdown", resetIdleTimer)
  window.removeEventListener("keydown", resetIdleTimer)
  window.removeEventListener("wheel", resetIdleTimer)
  window.removeEventListener("mousemove", onMouseMove)
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

const isOnboarding = computed(() => route.path === "/onboarding")

const prefersDark = ref(window.matchMedia("(prefers-color-scheme: dark)").matches)
const mq = window.matchMedia("(prefers-color-scheme: dark)")
function onMqChange(e: MediaQueryListEvent) { prefersDark.value = e.matches }
if (!isMobile.value) {
  onMounted(() => mq.addEventListener("change", onMqChange))
  onUnmounted(() => mq.removeEventListener("change", onMqChange))
}

const isDark = computed(() =>
  settings.theme.value === "dark" || (settings.theme.value === "system" && prefersDark.value)
)

const views: Record<string, typeof CalendarView> = {
  home:     HomeView,
  calendar: CalendarView,
  tasks:    KanbanView,
  settings: SettingsPanel,
}

const themeReady = ref(false)
const themeTransitioning = ref(false)
let themeTimer: ReturnType<typeof setTimeout>
const appReady = ref(false)

onMounted(() => {
  requestAnimationFrame(() => { themeReady.value = true })
  householdApi.getSettings()
    .then(s => {
      householdComplete.value = s.isComplete ?? false
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
  <!-- App-level loading spinner -->
  <div v-if="!appReady" class="app-loader">
    <div class="app-spinner" />
  </div>

  <!-- MOBILE branch -->
  <template v-if="isMobile && appReady">
    <MobileOnboardingGate v-if="!householdComplete" @joined="onMobileJoined" />
    <MobileShell v-else />
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

      <!-- Reminder heads-up display (kiosk) -->
      <HudAlert />

      <!-- New-version prompt (display clients only) -->
      <UpdatePrompt />

      <!-- Connection status indicator -->
      <div class="stream-status" :class="streamStatus" :title="streamStatus === 'connected' ? 'Live' : streamStatus === 'connecting' ? 'Connecting...' : 'Disconnected'">
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
</template>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--color-textPrimary);
  background-color: var(--color-bgBase);
}

.onboarding-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--color-textPrimary);
  background-color: var(--color-bgBase);
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
  top: 4px;
  right: 4px;
  z-index: 300;
}

.stream-dot {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition: background var(--duration-fast);
}

.stream-status.connected .stream-dot { background: var(--color-success,#8e9277); }
.stream-status.connecting .stream-dot { background: var(--color-warning,#caa681); animation: pulse 1s ease-in-out infinite; }
.stream-status.disconnected .stream-dot { background: var(--color-danger,#a87781); }

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

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

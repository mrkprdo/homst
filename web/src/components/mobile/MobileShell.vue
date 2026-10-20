<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import { useMembers } from "@/composables/useMembers"
import { useUi } from "@/composables/useUi"
import { memberColorHex, type MemberColor } from "@/types/household"
import { readableTextOn } from "@/utils/color"
import {
  PhCalendar,
  PhCheckSquare,
  PhDownloadSimple,
  PhPlus,
  PhUserCircle,
  PhX,
} from "@phosphor-icons/vue"
import MobileCalendarView from "./MobileCalendarView.vue"
import MobileTasksView from "./MobileTasksView.vue"
import MobileQuickAdd from "./MobileQuickAdd.vue"
import MobileProfile from "./MobileProfile.vue"
import EventDetailPanel from "@/components/events/EventDetailPanel.vue"
import TaskDetailPanel from "@/components/tasks/TaskDetailPanel.vue"

type MobileTab = "events" | "tasks"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

const ui = useUi()
const { members, ensureLoaded: loadMembers } = useMembers()

const tab = ref<MobileTab>("events")
const showQuickAdd = ref(false)
const showProfile = ref(false)
const showEventDetail = ref(false)
const showTaskDetail = ref(false)
const showInstallBanner = ref(true)

const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  (window.navigator as { standalone?: boolean }).standalone === true

/** iOS never fires beforeinstallprompt, so it gets written instructions instead. */
const isIos =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

const installPrompt = ref<BeforeInstallPromptEvent | null>(null)

function onBeforeInstallPrompt(e: Event) {
  e.preventDefault()
  installPrompt.value = e as BeforeInstallPromptEvent
}
window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt)
onUnmounted(() => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt))

const canInstall = computed(
  () => !isStandalone && showInstallBanner.value && (!!installPrompt.value || isIos),
)

function dismissInstall() {
  showInstallBanner.value = false
}

async function installApp() {
  const prompt = installPrompt.value
  if (!prompt) return
  await prompt.prompt()
  await prompt.userChoice
  // Either answer closes the banner — the native sheet already asked.
  showInstallBanner.value = false
  installPrompt.value = null
}

const todayLabel = new Date().toLocaleDateString("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
})

const currentMember = computed(() => members.value[0] ?? null)
const currentMemberColor = computed(() => {
  const m = currentMember.value
  if (!m) return "var(--color-bgSubtle)"
  return m.color.startsWith("#") ? m.color : memberColorHex(m.color as MemberColor)
})
const currentMemberText = computed(() => readableTextOn(currentMemberColor.value))

onMounted(() => {
  loadMembers()
})

function onSelectEvent(id: string) {
  showEventDetail.value = true
  ui.openDrawer("event-detail", id)
}
function onSelectTask(id: string) {
  showTaskDetail.value = true
  ui.openDrawer("task-detail", id)
}
function closeEventDetail() {
  showEventDetail.value = false
  ui.closeDrawer()
}
function closeTaskDetail() {
  showTaskDetail.value = false
  ui.closeDrawer()
}

// Detail panels can close themselves (delete, etc.) — keep the sheet in sync.
watch(
  () => ui.isDrawerOpen.value,
  (open) => {
    if (!open) {
      showEventDetail.value = false
      showTaskDetail.value = false
    }
  },
)
</script>

<template>
  <div class="mobile-shell">
    <header class="ms-appbar">
      <div class="ms-identity">
        <span class="ms-wordmark">HOMST</span>
        <span class="ms-date">{{ todayLabel }}</span>
      </div>
      <button
        class="ms-profile-btn"
        type="button"
        aria-label="Open profile"
        @click="showProfile = true"
      >
        <span
          v-if="currentMember"
          class="ms-avatar"
          :style="{ background: currentMemberColor, color: currentMemberText }"
          aria-hidden="true"
        >
          {{ (currentMember.name || "?")[0]?.toUpperCase() }}
        </span>
        <PhUserCircle v-else :size="26" />
      </button>
    </header>

    <div v-if="canInstall" class="ms-install-banner" role="region" aria-label="Install app">
      <button
        v-if="installPrompt"
        class="ms-install-action"
        type="button"
        @click="installApp"
      >
        <PhDownloadSimple :size="18" class="ms-install-icon" />
        <span class="ms-install-text">Install HOMST for full-screen reminders</span>
        <span class="ms-install-cta">Install</span>
      </button>
      <p v-else class="ms-install-hint">
        <PhDownloadSimple :size="18" class="ms-install-icon" />
        <span>Add HOMST to your Home Screen from the Share menu</span>
      </p>
      <button
        class="ms-install-dismiss"
        type="button"
        aria-label="Dismiss install banner"
        @click="dismissInstall"
      >
        <PhX :size="16" />
      </button>
    </div>

    <main class="ms-main">
      <div class="ms-view" :key="tab">
        <MobileCalendarView
          v-if="tab === 'events'"
          @select-event="onSelectEvent"
        />
        <MobileTasksView
          v-else
          @select-task="onSelectTask"
        />
      </div>
    </main>

    <nav class="ms-nav" aria-label="Primary">
      <button
        class="ms-tab"
        type="button"
        :class="{ active: tab === 'events' }"
        :aria-current="tab === 'events' ? 'page' : undefined"
        @click="tab = 'events'"
      >
        <PhCalendar :size="22" :weight="tab === 'events' ? 'fill' : 'regular'" />
        <span>Events</span>
      </button>

      <button
        class="ms-fab"
        type="button"
        aria-label="Add event or task"
        @click="showQuickAdd = true"
      >
        <PhPlus :size="26" weight="bold" />
      </button>

      <button
        class="ms-tab"
        type="button"
        :class="{ active: tab === 'tasks' }"
        :aria-current="tab === 'tasks' ? 'page' : undefined"
        @click="tab = 'tasks'"
      >
        <PhCheckSquare :size="22" :weight="tab === 'tasks' ? 'fill' : 'regular'" />
        <span>Tasks</span>
      </button>
    </nav>

    <MobileQuickAdd v-if="showQuickAdd" @close="showQuickAdd = false" />
    <MobileProfile v-if="showProfile" @close="showProfile = false" />

    <div v-if="showEventDetail" class="ms-detail-overlay" @click="closeEventDetail">
      <div
        class="ms-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Event details"
        @click.stop
      >
        <div class="ms-detail-handle" aria-hidden="true" />
        <div class="ms-detail-header">
          <h3>Event</h3>
          <button
            class="ms-detail-close"
            type="button"
            aria-label="Close event details"
            @click="closeEventDetail"
          >
            <PhX :size="20" />
          </button>
        </div>
        <div class="ms-detail-body">
          <EventDetailPanel />
        </div>
      </div>
    </div>

    <div v-if="showTaskDetail" class="ms-detail-overlay" @click="closeTaskDetail">
      <div
        class="ms-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
        @click.stop
      >
        <div class="ms-detail-handle" aria-hidden="true" />
        <div class="ms-detail-header">
          <h3>Task</h3>
          <button
            class="ms-detail-close"
            type="button"
            aria-label="Close task details"
            @click="closeTaskDetail"
          >
            <PhX :size="20" />
          </button>
        </div>
        <div class="ms-detail-body">
          <TaskDetailPanel />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mobile-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  height: 100dvh;
  overflow: hidden;
  position: relative;
  color: var(--color-textPrimary);
  background: var(--color-bgBase);
}

/* ── App bar ── */
.ms-appbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-shrink: 0;
  padding:
    calc(var(--space-2) + env(safe-area-inset-top, 0px))
    var(--space-4)
    var(--space-2);
}

.ms-identity {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.ms-wordmark {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-regular);
  letter-spacing: 0.16em;
  line-height: 1.2;
  color: var(--color-textSecondary);
}

.ms-date {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-regular);
  line-height: 1.25;
  color: var(--color-textPrimary);
}

.ms-profile-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  min-width: 48px;
  min-height: 48px;
  padding: 4px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textSecondary);
  cursor: pointer;
}

.ms-profile-btn:active {
  transform: scale(0.94);
}

.ms-profile-btn:focus-visible,
.ms-tab:focus-visible,
.ms-fab:focus-visible,
.ms-install-action:focus-visible,
.ms-install-dismiss:focus-visible,
.ms-detail-close:focus-visible {
  outline: 2px solid var(--color-accent-darker);
  outline-offset: 2px;
}

.ms-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
  color: var(--color-textInverse);
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  box-shadow:
    0 2px 0 0 var(--color-borderStrong),
    0 4px 12px -4px var(--shadow-accent-drop),
    inset 0 1px 3px var(--shadow-shine);
}

/* ── Install banner ── */
.ms-install-banner {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
  margin: 0 var(--space-4) var(--space-2);
  padding: 0 var(--space-1) 0 0;
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
}

.ms-install-action {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font-family: var(--font-family);
  font-size: inherit;
  text-align: left;
  cursor: pointer;
}

.ms-install-hint {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  line-height: 1.4;
}

.ms-install-icon {
  flex-shrink: 0;
  color: var(--color-accent-darker);
}

.ms-install-text {
  flex: 1;
  min-width: 0;
}

.ms-install-cta {
  flex-shrink: 0;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--color-accent-darker);
  color: var(--color-textInverse);
  font-weight: var(--font-weight-medium);
}

.ms-install-dismiss {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  min-width: 48px;
  min-height: 48px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textSecondary);
  cursor: pointer;
}

/* ── Content ── */
.ms-main {
  flex: 1;
  min-height: 0;
  position: relative;
}

.ms-main > :deep(*) {
  height: 100%;
}

.ms-view {
  height: 100%;
  animation: ms-view-in var(--duration-base) cubic-bezier(0.2, 0.7, 0.3, 1) both;
}

@keyframes ms-view-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ── Bottom navigation ── */
.ms-nav {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
  padding:
    var(--space-2)
    var(--space-4)
    calc(var(--space-2) + env(safe-area-inset-bottom, 0px));
  background: var(--color-bgSurface);
  border-top: 1px solid var(--color-border);
}

.ms-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  min-height: 52px;
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-textSecondary);
  font-family: var(--font-family);
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.02em;
  cursor: pointer;
  transition:
    background var(--duration-fast) cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color var(--duration-fast) cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.ms-tab.active {
  color: var(--color-accent-darker);
  background: var(--color-accent-lighter);
}

.ms-tab:active {
  transform: scale(0.96);
}

.ms-fab {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  min-width: 56px;
  min-height: 56px;
  border: none;
  border-radius: var(--radius-full);
  background: linear-gradient(
    165deg,
    var(--color-accent-dark),
    var(--color-accent-darker) 60%
  );
  color: var(--color-textInverse);
  cursor: pointer;
  box-shadow:
    0 3px 0 0 var(--color-accent-darker),
    0 8px 20px -6px var(--shadow-accent-drop),
    inset 0 2px 5px var(--shadow-shine);
  transition: transform var(--duration-fast) cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.ms-fab:active {
  transform: translateY(2px) scale(0.96);
  box-shadow: inset 0 3px 8px var(--shadow-accent-drop);
}

/* ── Detail sheets ── */
.ms-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(30, 24, 32, 0.3);
  animation: ms-backdrop-in var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

:global(.dark) .ms-detail-overlay {
  background: rgba(0, 0, 0, 0.55);
}

.ms-detail-sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 88vh;
  max-height: 88dvh;
  background: var(--color-bgElevated);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  box-shadow: 0 -10px 40px -16px rgba(0, 0, 0, 0.35);
  animation: ms-sheet-in var(--duration-slow) cubic-bezier(0.2, 0.7, 0.3, 1) both;
}

@keyframes ms-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes ms-sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.ms-detail-handle {
  width: 40px;
  height: 4px;
  margin: var(--space-2) auto var(--space-1);
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--color-borderStrong);
}

.ms-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-4) var(--space-1);
  flex-shrink: 0;
}

.ms-detail-header h3 {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
}

.ms-detail-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  min-width: 48px;
  min-height: 48px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textSecondary);
  cursor: pointer;
}

.ms-detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
  overscroll-behavior: contain;
}

/* Detail panels use small desktop action buttons — keep touch targets at 48px. */
.ms-detail-body :deep(.ui-btn) {
  min-height: 48px;
}
</style>

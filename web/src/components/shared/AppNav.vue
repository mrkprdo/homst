<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from "vue"
import { useUi, type PanelView } from "@/composables/useUi"
import { useSettings } from "@/composables/useSettings"
import { PhCalendar, PhKanban, PhGear, PhMegaphone, PhUserCircle } from "@phosphor-icons/vue"
import { animate, stagger, springs, dur } from "@/lib/motion"

const ui = useUi()
const settings = useSettings()

const navEl = ref<HTMLElement | null>(null)

const navItems: { id: PanelView; icon: typeof PhCalendar; label: string }[] = [
  { id: "calendar",      icon: PhCalendar,  label: "Calendar"      },
  { id: "tasks",         icon: PhKanban,    label: "Tasks"         },
  { id: "announcements", icon: PhMegaphone, label: "Announcements" },
  { id: "settings",      icon: PhGear,      label: "Settings"      },
]

const RAIL_PX = 72
const HANDLE_PX = 4
const HOT_ZONE_PX = 20
const TOUCH_HOT_ZONE_PX = 40
const HIDE_DELAY_MS = 200
const TOUCH_LINGER_MS = 5000
const FIRST_HIDE_MS = 3000

const autoHide = computed(() => settings.navAutoHide.value)
const hidden = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null
let lastPointerX: number | null = null
let keyboardMode = false
let focusWithin = false

function railWidth() {
  return navEl.value?.offsetWidth || RAIL_PX
}

function cancelHide() {
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function showNav() {
  cancelHide()
  hidden.value = false
}

function scheduleHide(delay = HIDE_DELAY_MS) {
  if (!autoHide.value) return
  cancelHide()
  hideTimer = setTimeout(() => {
    hideTimer = null
    if (keyboardMode && focusWithin) return
    hidden.value = true
  }, delay)
}

function onPointerMove(e: PointerEvent) {
  lastPointerX = e.clientX
  if (!autoHide.value) return
  if (hidden.value) {
    if (e.clientX <= HANDLE_PX + HOT_ZONE_PX) showNav()
    return
  }
  const target = e.target
  const overRail = target instanceof Node && navEl.value?.contains(target) === true
  if (overRail || e.clientX <= railWidth()) {
    cancelHide()
    return
  }
  scheduleHide()
}

function onPointerLeave(e: PointerEvent) {
  if (e.pointerType === "touch" || !autoHide.value || hidden.value) return
  scheduleHide()
}

function onPointerDown(e: PointerEvent) {
  keyboardMode = false
  if (!autoHide.value) return
  if (hidden.value) {
    const reach = e.pointerType === "mouse" ? HANDLE_PX + HOT_ZONE_PX : HANDLE_PX + TOUCH_HOT_ZONE_PX
    if (e.clientX <= reach) {
      showNav()
      if (e.pointerType !== "mouse") scheduleHide(TOUCH_LINGER_MS)
    }
    return
  }
  const target = e.target
  if (target instanceof Node && navEl.value?.contains(target)) {
    if (e.pointerType !== "mouse") scheduleHide(TOUCH_LINGER_MS)
    return
  }
  scheduleHide()
}

function onKeyDown() {
  keyboardMode = true
}

function onFocusIn() {
  focusWithin = true
  if (!autoHide.value) return
  showNav()
}

function onFocusOut(e: FocusEvent) {
  const next = e.relatedTarget
  focusWithin = next instanceof Node && navEl.value?.contains(next) === true
  if (!autoHide.value || focusWithin) return
  scheduleHide()
}

onMounted(() => {
  animate(navEl.value!, {
    translateX: ["-4px", "0px"],
    opacity: [0, 1],
    duration: dur.slow,
    ease: springs.overlay,
    onComplete: () => {
      if (!navEl.value) return
      navEl.value.style.removeProperty("transform")
      navEl.value.style.opacity = "1"
    },
  })

  const items = navEl.value!.querySelectorAll(".nav-logo, .nav-item, .nav-item--profile")
  animate(items, {
    translateX: ["-10px", "0px"],
    opacity: [0, 1],
    ease: springs.enter,
    delay: stagger(45, { start: 80 }),
  })

  window.addEventListener("pointermove", onPointerMove, { passive: true })
  window.addEventListener("pointerdown", onPointerDown, { passive: true })
  window.addEventListener("keydown", onKeyDown)

  if (autoHide.value) scheduleHide(FIRST_HIDE_MS)
})

onUnmounted(() => {
  cancelHide()
  window.removeEventListener("pointermove", onPointerMove)
  window.removeEventListener("pointerdown", onPointerDown)
  window.removeEventListener("keydown", onKeyDown)
})

watch(autoHide, (on) => {
  cancelHide()
  hidden.value = false
  if (!on) return
  if (lastPointerX !== null && lastPointerX <= HANDLE_PX + HOT_ZONE_PX) return
  scheduleHide(FIRST_HIDE_MS)
})
</script>

<template>
  <nav
    ref="navEl"
    class="app-nav"
    :class="{
      'app-nav--autohide': autoHide,
      'app-nav--hidden': autoHide && hidden,
    }"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @pointerleave="onPointerLeave"
  >
    <button
      class="nav-logo"
      :class="{ active: ui.activePanel.value === 'home' }"
      aria-label="Home"
      title="Home"
      @click="ui.setPanel('home')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="36" height="36" aria-hidden="true">
        <rect width="100" height="100" rx="28" fill="#e0e8e8" />
        <path d="M50 22 L78 46 L72 46 L72 76 L58 76 L58 58 L42 58 L42 76 L28 76 L28 46 L22 46 Z" fill="#586a6a" opacity="0.9" />
        <rect x="43" y="59" width="14" height="17" rx="4" fill="#e0e8e8" />
        <path d="M50 24 L76 47" stroke="rgba(255,255,255,0.35)" stroke-width="2.5" stroke-linecap="round" />
      </svg>
    </button>

    <button
      v-for="item in navItems"
      :key="item.id"
      class="nav-item"
      :class="{ active: ui.activePanel.value === item.id }"
      @click="ui.setPanel(item.id)"
      :aria-label="item.label"
      :title="item.label"
    >
      <component :is="item.icon" :size="22" aria-hidden="true" />
    </button>

    <div class="nav-spacer" />

    <button
      class="nav-item nav-item--profile"
      :class="{ active: ui.drawer.value.type === 'member-detail' }"
      @click="ui.openDrawer('member-detail')"
      aria-label="Profile"
      title="Profile"
    >
      <PhUserCircle :size="22" aria-hidden="true" />
    </button>
  </nav>
</template>

<style scoped>
.app-nav {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 72px;
  padding: var(--space-3) 0;
  background: var(--color-bgSurface);
  box-shadow: inset -1px 0 0 var(--color-border);
  gap: var(--space-2);
  flex-shrink: 0;
  position: relative;
  z-index: 60;
  opacity: 0;
  transition: transform var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94),
              box-shadow var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.app-nav--autohide {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  height: 100%;
  box-shadow: inset -1px 0 0 var(--color-border),
              6px 0 18px -14px rgba(0, 0, 0, 0.5);
  border-radius: 0 4px 4px 0;
}

.app-nav--autohide.app-nav--hidden {
  transform: translateX(calc(-100% + 4px));
}

.nav-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  min-width: unset;
  min-height: unset;
  margin-bottom: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  padding: 0;
  transition: transform var(--duration-fast) cubic-bezier(0.25, 0.46, 0.45, 0.94),
              box-shadow var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94);
  opacity: 0;
}

.nav-logo svg {
  flex-shrink: 0;
}

.nav-logo:hover svg rect:first-child {
  filter: brightness(0.95);
}

.nav-logo:active {
  transform: scale(0.92);
  transition-duration: 60ms;
}

.nav-logo.active {
  box-shadow: 0 0 0 3px var(--color-primary);
  border-radius: var(--radius-md);
}

.nav-spacer {
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-textMuted);
  cursor: pointer;
  transition: color var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94),
              background var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94),
              box-shadow var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94),
              transform var(--duration-fast) cubic-bezier(0.25, 0.46, 0.45, 0.94);
  opacity: 0;
}

.nav-item:hover {
  color: var(--color-textSecondary);
  background: var(--color-bgSubtle);
}

.nav-item:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.nav-item.active {
  color: var(--color-textInverse);
  background: var(--color-primary);
  box-shadow: 0 2px 0 0 var(--color-primaryDark),
              0 4px 12px -2px var(--shadow-accent-drop, rgba(0,0,0,0.20));
  transform: scale(1.05);
}

.nav-item:active {
  transform: scale(0.94);
  transition-duration: 80ms;
}

.nav-item--profile {
  margin-bottom: var(--space-1);
}
</style>

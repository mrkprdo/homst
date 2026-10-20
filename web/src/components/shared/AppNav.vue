<script setup lang="ts">
import { ref, onMounted } from "vue"
import { useUi, type PanelView } from "@/composables/useUi"
import { PhCalendar, PhKanban, PhGear, PhUserCircle } from "@phosphor-icons/vue"
import { animate, stagger, springs, dur } from "@/lib/motion"

const ui = useUi()

const navEl = ref<HTMLElement | null>(null)

const navItems: { id: PanelView; icon: typeof PhCalendar; label: string }[] = [
  { id: "calendar", icon: PhCalendar, label: "Calendar" },
  { id: "tasks",    icon: PhKanban,   label: "Tasks"    },
  { id: "settings", icon: PhGear,     label: "Settings" },
]

onMounted(() => {
  // Nav rail slides in from left with spring
  animate(navEl.value!, {
    translateX: ["-4px", "0px"],
    opacity: [0, 1],
    duration: dur.slow,
    ease: springs.overlay,
  })

  // Items stagger in with spring — start 80ms after nav begins
  const items = navEl.value!.querySelectorAll(".nav-logo, .nav-item, .nav-item--profile")
  animate(items, {
    translateX: ["-10px", "0px"],
    opacity: [0, 1],
    ease: springs.enter,
    delay: stagger(45, { start: 80 }),
  })
})
</script>

<template>
  <nav ref="navEl" class="app-nav">
    <!-- Logo / Home button -->
    <button
      class="nav-logo"
      :class="{ active: ui.activePanel.value === 'home' }"
      aria-label="Home"
      @click="ui.setPanel('home')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="36" height="36">
        <rect width="100" height="100" rx="28" fill="#e0e8e8" />
        <path d="M50 22 L78 46 L72 46 L72 76 L58 76 L58 58 L42 58 L42 76 L28 76 L28 46 L22 46 Z" fill="#586a6a" opacity="0.9" />
        <rect x="43" y="59" width="14" height="17" rx="4" fill="#e0e8e8" />
        <path d="M50 24 L76 47" stroke="rgba(255,255,255,0.35)" stroke-width="2.5" stroke-linecap="round" />
      </svg>
    </button>

    <!-- Nav items -->
    <button
      v-for="item in navItems"
      :key="item.id"
      class="nav-item"
      :class="{ active: ui.activePanel.value === item.id }"
      @click="ui.setPanel(item.id)"
      :aria-label="item.label"
    >
      <component :is="item.icon" :size="22" />
    </button>

    <!-- Spacer -->
    <div class="nav-spacer" />

    <!-- Profile -->
    <button
      class="nav-item nav-item--profile"
      :class="{ active: ui.drawer.value.type === 'member-detail' }"
      @click="ui.openDrawer('member-detail')"
      aria-label="Profile"
    >
      <PhUserCircle :size="22" />
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
  /* Initial state — anime.js takes over on mount */
  opacity: 0;
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
  /* Hidden until stagger reaches this element */
  opacity: 0;
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
  /* Hidden until stagger reaches this element */
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

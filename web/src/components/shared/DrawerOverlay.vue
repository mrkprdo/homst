<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, defineAsyncComponent } from "vue"
import { useUi } from "@/composables/useUi"
import { PhX } from "@phosphor-icons/vue"
import { animate, ease } from "@/lib/motion"
import { scheduleIdle } from "@/lib/idle"

const loadQuickAdd = () => import("@/components/shared/QuickAddForm.vue")
const QuickAddForm = defineAsyncComponent({ loader: loadQuickAdd, delay: 0 })
const isTestEnv = (import.meta as any).env?.MODE === "test"
let cancelPrefetch: (() => void) | null = null

const ui = useUi()

const drawerEl = ref<HTMLElement | null>(null)
const drawerVisible = computed(() => ui.drawer.value.type !== null)

const drawerLabel = computed(() => {
  switch (ui.drawer.value.type) {
    case "event-detail": return "Event details"
    case "task-detail": return "Task details"
    case "member-detail": return "Household member"
    case "quick-add": return ui.drawer.value.aiConversationId || ui.drawer.value.aiEventId
      ? "Smart import"
      : "Quick add"
    case "confirm": return "Confirm"
    default: return "Details"
  }
})

function onBackdropClick() {
  ui.closeDrawer()
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

function focusableItems(): HTMLElement[] {
  return Array.from(drawerEl.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    .filter((el) => el.getClientRects().length > 0)
}

let lastFocused: HTMLElement | null = null

function onDocumentKeydown(e: KeyboardEvent) {
  if (!ui.isDrawerOpen.value) return

  if (e.key === "Escape") {
    e.preventDefault()
    e.stopPropagation()
    ui.closeDrawer()
    return
  }

  if (e.key !== "Tab") return

  const items = focusableItems()
  if (!items.length) {
    e.preventDefault()
    drawerEl.value?.focus()
    return
  }

  const first = items[0]!
  const last = items[items.length - 1]!

  if (!drawerEl.value?.contains(document.activeElement)) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
    return
  }

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

watch(() => ui.isDrawerOpen.value, async (open) => {
  if (!drawerEl.value) return

  if (open) {
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener("keydown", onDocumentKeydown, true)

    drawerEl.value.style.removeProperty("transform")
    if (!drawerEl.value.style.getPropertyValue("--drawer-p")) {
      drawerEl.value.style.setProperty("--drawer-p", "0")
    }
    animate(drawerEl.value, {
      "--drawer-p": 1,
      duration: 420,
      ease: "outBack",
    })

    await nextTick()
    requestAnimationFrame(() => {
      if (drawerEl.value?.contains(document.activeElement)) return
      drawerEl.value?.focus()
    })
  } else {
    document.removeEventListener("keydown", onDocumentKeydown, true)
    animate(drawerEl.value, {
      "--drawer-p": 0,
      duration: 200,
      ease: ease.in,
    })
    lastFocused?.focus?.()
    lastFocused = null
  }
})

onMounted(() => {
  if (!isTestEnv) cancelPrefetch = scheduleIdle(() => void loadQuickAdd())
})

onUnmounted(() => {
  document.removeEventListener("keydown", onDocumentKeydown, true)
  cancelPrefetch?.()
  cancelPrefetch = null
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="drawerVisible"
      class="backdrop"
      :class="{ 'backdrop--open': ui.isDrawerOpen.value }"
      @click="onBackdropClick"
    />
    <div
      v-if="drawerVisible"
      ref="drawerEl"
      class="drawer clay-shadow-accent"
      role="dialog"
      aria-modal="true"
      :aria-label="drawerLabel"
      tabindex="-1"
    >
      <div class="drawer-header">
        <div v-if="ui.drawer.value.type === 'member-detail'" class="drawer-brand">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="32" height="32" aria-hidden="true">
            <rect width="100" height="100" rx="28" fill="#e0e8e8" />
            <path d="M50 22 L78 46 L72 46 L72 76 L58 76 L58 58 L42 58 L42 76 L28 76 L28 46 L22 46 Z" fill="#586a6a" opacity="0.9" />
            <rect x="43" y="59" width="14" height="17" rx="4" fill="#e0e8e8" />
            <path d="M50 24 L76 47" stroke="rgba(255,255,255,0.35)" stroke-width="2.5" stroke-linecap="round" />
          </svg>
          <span class="drawer-wordmark">HOMST</span>
        </div>
        <h3 v-else-if="ui.drawer.value.type === 'event-detail'">Event</h3>
        <h3 v-else-if="ui.drawer.value.type === 'task-detail'">Task</h3>
        <h3 v-else-if="ui.drawer.value.type === 'quick-add'">
          {{ ui.drawer.value.aiConversationId || ui.drawer.value.aiEventId
            ? "Smart import"
            : "Quick Add" }}
        </h3>
        <h3 v-else-if="ui.drawer.value.type === 'confirm'">Confirm</h3>
        <button class="close-btn" @click="ui.closeDrawer()" aria-label="Close">
          <PhX :size="20" />
        </button>
      </div>
      <div class="drawer-content">
        <QuickAddForm v-if="ui.drawer.value.type === 'quick-add'" />
        <slot v-else />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: var(--color-bgBase);
  opacity: 0;
  z-index: 100;
  transition: opacity var(--duration-spring) cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.backdrop--open {
  opacity: 0.72;
  pointer-events: auto;
}

.dark .backdrop--open {
  opacity: 0.85;
}

.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(480px, 100vw);
  background: var(--color-bgElevated);
  z-index: 101;
  --drawer-p: 0;
  transform-origin: right center;
  transform:
    translateX(calc(max(0, 1 - var(--drawer-p)) * 100%))
    scaleX(max(1, var(--drawer-p)));
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  display: flex;
  flex-direction: column;
  will-change: transform;
}

.drawer:focus {
  outline: none;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-5) var(--space-5) var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.drawer-header h3 {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textSecondary);
  cursor: pointer;
  transition: background var(--duration-fast);
}

.close-btn:hover {
  background: var(--color-bgSubtle);
}

.close-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.drawer-brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.drawer-wordmark {
  font-size: var(--text-title-size);
  font-weight: var(--font-weight-thin);
  letter-spacing: 0.12em;
  color: var(--color-primary);
  text-transform: uppercase;
}

.drawer-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4) var(--space-5);
}
</style>

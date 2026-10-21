<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import { PhMegaphone, PhX } from "@phosphor-icons/vue"
import { useAnnouncements, type Announcement } from "@/composables/useAnnouncements"
import { useUi } from "@/composables/useUi"

defineProps<{ display?: boolean }>()

const { visible, dismiss, ensureLoaded } = useAnnouncements()
const ui = useUi()

const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined

/**
 * The announcement screen already lists every active message. A second banner
 * there would cover the composer, so it is suppressed until you leave.
 */
const onAnnouncementScreen = computed(
  () => ui.activePanel.value === "announcements" || ui.announcementsOpen.value,
)
const shown = computed(() => (onAnnouncementScreen.value ? [] : visible(now.value).slice(0, 3)))

onMounted(() => {
  void ensureLoaded()
  timer = setInterval(() => { now.value = Date.now() }, 15_000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function timeLabel(a: Announcement): string {
  const created = new Date(a.createdAt)
  if (Number.isNaN(created.getTime())) return "Just now"

  const sent = created.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  if (!a.expiresAt) return `Sent at ${sent}`

  const expires = new Date(a.expiresAt)
  if (Number.isNaN(expires.getTime())) return `Sent at ${sent}`
  const until = expires.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  return `Sent at ${sent} · until ${until}`
}
</script>

<template>
  <Teleport to="body">
    <Transition name="announcement-blur">
      <div v-if="shown.length" class="announcement-backdrop" aria-hidden="true" />
    </Transition>

    <TransitionGroup
      v-if="shown.length"
      name="announcement"
      tag="div"
      class="announcement-stack"
      :class="{ 'announcement-stack--display': display }"
      aria-live="polite"
      aria-atomic="false"
    >
      <article
        v-for="a in shown"
        :key="a.id"
        class="announcement-card"
        :class="{ 'announcement-card--display': display }"
        role="status"
      >
        <span class="announcement-icon" aria-hidden="true">
          <PhMegaphone :size="24" weight="fill" />
        </span>
        <div class="announcement-body">
          <p class="announcement-meta">
            Announcement<span v-if="a.authorName"> · {{ a.authorName }}</span>
          </p>
          <p class="announcement-message">{{ a.message }}</p>
          <p class="announcement-time">{{ timeLabel(a) }}</p>
        </div>
        <button
          class="announcement-dismiss"
          type="button"
          aria-label="Dismiss announcement"
          @click="dismiss(a.id)"
        >
          <PhX :size="20" weight="bold" />
        </button>
      </article>
    </TransitionGroup>
  </Teleport>
</template>

<style scoped>
.announcement-backdrop {
  position: fixed;
  inset: 0;
  z-index: 340;
  pointer-events: none;
  background: color-mix(in srgb, var(--color-bgBase) 4%, transparent);
  /* Prefixed first: Lightning CSS drops the standard property if it comes first. */
  -webkit-backdrop-filter: blur(1.5px);
  backdrop-filter: blur(1.5px);
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .announcement-backdrop {
    background: rgba(0, 0, 0, 0.3);
  }
}

.announcement-blur-enter-active,
.announcement-blur-leave-active {
  transition: opacity var(--duration-base) ease;
}

.announcement-blur-enter-from,
.announcement-blur-leave-to {
  opacity: 0;
}

.announcement-stack {
  position: fixed;
  top: var(--space-8);
  left: 50%;
  z-index: 350;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(680px, calc(100vw - 2 * var(--space-4)));
  transform: translateX(-50%);
  pointer-events: none;
}

.announcement-stack--display {
  width: min(880px, calc(100vw - 2 * var(--space-8)));
}

.announcement-card {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--color-bgElevated);
  border: 2px solid color-mix(in srgb, var(--color-primary) 60%, var(--color-border));
  border-radius: var(--radius-md);
  box-shadow:
    0 4px 0 0 color-mix(in srgb, var(--color-primary) 30%, transparent),
    0 20px 56px -14px color-mix(in srgb, var(--color-primary) 42%, transparent),
    inset 0 1px 2px var(--shadow-shine);
}

.announcement-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--color-accent-lighter);
  color: var(--color-ink, #15171c);
}

.announcement-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.announcement-meta {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-primary);
}

.announcement-message {
  font-size: var(--text-heading-size);
  line-height: 1.35;
  color: var(--color-textPrimary);
  overflow-wrap: anywhere;
}

.announcement-time {
  margin-top: 2px;
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  font-variant-numeric: tabular-nums;
}

.announcement-dismiss {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textMuted);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.announcement-dismiss:hover {
  background: var(--color-bgSubtle);
  color: var(--color-textPrimary);
}

.announcement-dismiss:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* ── Wall display: larger cards with a breathing accent glow ── */
.announcement-card--display {
  gap: var(--space-5);
  padding: var(--space-6);
  border-width: 3px;
  animation: announcement-breathe 2.8s ease-in-out infinite;
}

.announcement-card--display .announcement-icon {
  width: 60px;
  height: 60px;
}

.announcement-card--display .announcement-icon :deep(svg) {
  width: 30px;
  height: 30px;
}

.announcement-card--display .announcement-meta {
  font-size: var(--text-body-size);
}

.announcement-card--display .announcement-message {
  font-size: var(--text-title-size);
  line-height: 1.3;
}

.announcement-card--display .announcement-time {
  font-size: var(--text-body-size);
}

.announcement-card--display .announcement-dismiss {
  width: 56px;
  height: 56px;
}

@keyframes announcement-breathe {
  0%,
  100% {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--color-primary) 18%, transparent),
      0 0 12px 1px color-mix(in srgb, var(--color-primary) 22%, transparent),
      0 20px 48px -14px color-mix(in srgb, var(--color-primary) 28%, transparent),
      inset 0 1px 2px var(--shadow-shine);
  }
  50% {
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--color-primary) 35%, transparent),
      0 0 26px 5px color-mix(in srgb, var(--color-primary) 40%, transparent),
      0 24px 64px -12px color-mix(in srgb, var(--color-primary) 42%, transparent),
      inset 0 1px 2px var(--shadow-shine);
  }
}

@media (prefers-reduced-motion: reduce) {
  .announcement-card--display {
    animation: none;
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--color-primary) 35%, transparent),
      0 0 26px 5px color-mix(in srgb, var(--color-primary) 40%, transparent),
      0 24px 64px -12px color-mix(in srgb, var(--color-primary) 42%, transparent),
      inset 0 1px 2px var(--shadow-shine);
  }
}

.announcement-enter-active,
.announcement-leave-active,
.announcement-move {
  transition: opacity var(--duration-base), transform var(--duration-base);
}

.announcement-enter-from,
.announcement-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.97);
}

.announcement-leave-active {
  position: absolute;
  width: 100%;
}

@media (max-width: 700px) {
  .announcement-stack {
    top: calc(env(safe-area-inset-top, 0px) + 84px);
    width: calc(100vw - 2 * var(--space-3));
  }

  .announcement-card {
    padding: var(--space-3);
  }

  .announcement-icon {
    width: 40px;
    height: 40px;
  }

  .announcement-message {
    font-size: var(--text-body-size);
  }
}
</style>

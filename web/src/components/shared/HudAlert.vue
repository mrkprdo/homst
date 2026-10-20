<script setup lang="ts">
import { PhBell, PhX } from "@phosphor-icons/vue"
import { useNotifications, type HudNotification } from "@/composables/useNotifications"

defineProps<{ display?: boolean }>()

const { notifications, dismiss } = useNotifications()

function minutesUntil(n: HudNotification): number | null {
  if (!n.startAt) return null
  return Math.round((new Date(n.startAt).getTime() - Date.now()) / 60000)
}

function dayLabel(start: Date, now: Date): string | null {
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (start.toDateString() === now.toDateString()) return "today"
  if (start.toDateString() === tomorrow.toDateString()) return "tomorrow"
  return start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function whenLabel(n: HudNotification): string {
  if (!n.startAt) return "starting soon"
  const start = new Date(n.startAt)
  const now = new Date()
  const day = dayLabel(start, now)
  const time = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })

  if (n.allDay) return day === "today" ? "All day today" : `All day ${day}`

  const mins = minutesUntil(n)
  if (mins === null || mins < 0) return `${time} · ${day}`
  if (mins <= 1) return `Starting now · ${time}`
  const prefix = day === "today" ? `In ${mins} min` : `In ${mins} min · ${day}`
  return `${prefix} · ${time}`
}
</script>

<template>
  <Teleport to="body">
    <Transition name="hud-blur">
      <div v-if="notifications.length" class="hud-backdrop" aria-hidden="true" />
    </Transition>

    <TransitionGroup
      v-if="notifications.length"
      name="hud"
      tag="div"
      class="hud-stack"
      :class="{ 'hud-stack--display': display }"
    >
      <article
        v-for="n in notifications"
        :key="n.id"
        class="hud-card"
        :class="{ 'hud-card--display': display }"
        role="alert"
      >
        <span class="hud-icon">
          <PhBell :size="26" weight="fill" />
        </span>
        <span class="hud-body">
          <span class="hud-title">{{ n.title }}</span>
          <span class="hud-when">{{ whenLabel(n) }}</span>
        </span>
        <button class="hud-dismiss" aria-label="Dismiss reminder" @click="dismiss(n.id)">
          <PhX :size="22" weight="bold" />
        </button>
      </article>
    </TransitionGroup>
  </Teleport>
</template>

<style scoped>
.hud-stack {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 400;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: min(580px, calc(100vw - 2 * var(--space-6)));
  pointer-events: none;
}

.hud-backdrop {
  position: fixed;
  inset: 0;
  z-index: 390;
  pointer-events: none;
  background: color-mix(in srgb, var(--color-bgBase) 4%, transparent);
  backdrop-filter: blur(1.5px);
  -webkit-backdrop-filter: blur(1.5px);
}

.hud-blur-enter-active,
.hud-blur-leave-active {
  transition: opacity var(--duration-base) ease;
}

.hud-blur-enter-from,
.hud-blur-leave-to {
  opacity: 0;
}

.hud-stack--display {
  width: min(860px, calc(100vw - 2 * var(--space-8)));
}

.hud-card {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-5);
  background: var(--color-bgElevated);
  border: 2px solid color-mix(in srgb, var(--color-danger) 70%, var(--color-border));
  border-left: 8px solid var(--color-danger);
  border-radius: var(--radius-md);
  box-shadow:
    0 4px 0 0 color-mix(in srgb, var(--color-danger) 35%, transparent),
    0 24px 64px -12px color-mix(in srgb, var(--color-danger) 45%, transparent),
    inset 0 1px 2px var(--shadow-shine);
}

.hud-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-danger) 18%, transparent);
  color: var(--color-danger);
}

.hud-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  flex: 1;
}

.hud-title {
  font-size: var(--text-title-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hud-when {
  font-size: var(--text-body-size);
  color: var(--color-textSecondary);
  font-variant-numeric: tabular-nums;
}

.hud-dismiss {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textMuted);
  cursor: pointer;
  min-width: unset;
  min-height: unset;
  transition: background var(--duration-fast), color var(--duration-fast);
}
.hud-dismiss:hover { background: var(--color-bgSubtle); color: var(--color-textPrimary); }

/* ── Wall display: larger cards with a breathing danger glow ── */
.hud-card--display {
  gap: var(--space-5);
  padding: var(--space-6);
  border-width: 3px;
  border-left-width: 10px;
  animation: hud-breathe 2.8s ease-in-out infinite;
}

.hud-card--display .hud-icon {
  width: 64px;
  height: 64px;
}

.hud-card--display .hud-icon :deep(svg) {
  width: 32px;
  height: 32px;
}

.hud-card--display .hud-title {
  font-size: var(--text-title-size);
}

.hud-card--display .hud-when {
  font-size: var(--text-body-size);
}

.hud-card--display .hud-dismiss {
  width: 56px;
  height: 56px;
}

@keyframes hud-breathe {
  0%,
  100% {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--color-danger) 18%, transparent),
      0 0 12px 1px color-mix(in srgb, var(--color-danger) 22%, transparent),
      0 20px 48px -14px color-mix(in srgb, var(--color-danger) 28%, transparent),
      inset 0 1px 2px var(--shadow-shine);
  }
  50% {
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--color-danger) 35%, transparent),
      0 0 26px 5px color-mix(in srgb, var(--color-danger) 40%, transparent),
      0 24px 64px -12px color-mix(in srgb, var(--color-danger) 42%, transparent),
      inset 0 1px 2px var(--shadow-shine);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hud-card--display {
    animation: none;
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--color-danger) 35%, transparent),
      0 0 26px 5px color-mix(in srgb, var(--color-danger) 40%, transparent),
      0 24px 64px -12px color-mix(in srgb, var(--color-danger) 42%, transparent),
      inset 0 1px 2px var(--shadow-shine);
  }
}

/* Arrival / dismissal motion — reduced-motion zeroes the duration tokens. */
.hud-enter-active,
.hud-leave-active,
.hud-move {
  transition: opacity var(--duration-base), transform var(--duration-base);
}
.hud-enter-from,
.hud-leave-to {
  opacity: 0;
  transform: scale(0.92);
}
.hud-leave-active {
  position: absolute;
  width: 100%;
}
</style>

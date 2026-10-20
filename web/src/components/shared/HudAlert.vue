<script setup lang="ts">
import { PhBell, PhX } from "@phosphor-icons/vue"
import { useNotifications, type HudNotification } from "@/composables/useNotifications"

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
    <TransitionGroup v-if="notifications.length" name="hud" tag="div" class="hud-stack">
      <article v-for="n in notifications" :key="n.id" class="hud-card" role="alert">
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

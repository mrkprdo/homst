<script setup lang="ts">
import { ref, computed } from "vue"
import { animate, springs } from "@/lib/motion"

const props = defineProps<{
  color?: string  // hex color; defaults to sage
  title: string
  time?: string
  allDay?: boolean
}>()

defineEmits<{ click: [] }>()

const chipEl = ref<HTMLElement | null>(null)

function hexToRgba(hex: string, alpha: number): string {
  const c = hex.startsWith("#") ? hex.slice(1) : hex
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const chipColor = computed(() => props.color ?? "#b1b695")

const chipStyle = computed(() => ({
  "--chip-color": chipColor.value,
  "--chip-bg": hexToRgba(chipColor.value, 0.28),
}))

function onPointerDown() {
  if (!chipEl.value) return
  animate(chipEl.value, { scale: 0.93, duration: 60, ease: "outQuart" })
}

function onPointerUp() {
  if (!chipEl.value) return
  animate(chipEl.value, { scale: [0.93, 1.06, 1], ease: springs.pop })
}
</script>

<template>
  <div
    ref="chipEl"
    class="event-chip"
    :style="chipStyle"
    role="button"
    tabindex="0"
    @click.stop="$emit('click')"
    @keydown.enter.stop="$emit('click')"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
  >
    <span v-if="time && !allDay" class="event-chip__time">{{ time }}</span>
    <span class="event-chip__title">{{ title }}</span>
  </div>
</template>

<style scoped>
.event-chip {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px 5px;
  border-radius: var(--radius-xs);
  border-left: 2px solid var(--chip-color);
  background: var(--chip-bg);
  color: var(--color-textPrimary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-regular);
  line-height: 1.3;
  overflow: hidden;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  touch-action: manipulation;
  will-change: transform;
  position: relative;
  z-index: 0;
  transition: box-shadow var(--duration-fast), z-index 0s;
}

.event-chip:hover {
  transform: translateY(-1px);
  box-shadow:
    0 1px 0 0 var(--shadow-lip),
    0 3px 12px -2px color-mix(in srgb, var(--chip-color) 55%, transparent);
  z-index: 10;
}

.event-chip:focus-visible {
  outline: 2px solid var(--chip-color);
  outline-offset: 2px;
}

.event-chip__time {
  flex-shrink: 0;
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
}

.event-chip__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

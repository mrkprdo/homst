<script setup lang="ts">
import { ref } from "vue"
import { animate, springs } from "@/lib/motion"

const props = defineProps<{
  color?: "peach" | "sage" | "mauve" | "plum" | "sky"
  title: string
  priority?: "low" | "medium" | "high"
  dueDate?: string
  assigneeInitials?: string
  done?: boolean
}>()

const cardEl = ref<HTMLElement | null>(null)

function onPointerDown() {
  if (props.done || !cardEl.value) return
  animate(cardEl.value, {
    scaleX: 1.02,
    scaleY: 0.96,
    translateY: "4px",
    duration: 80,
    ease: "outQuart",
  })
}

function onPointerUp() {
  if (!cardEl.value) return
  animate(cardEl.value, {
    scaleX: [1.02, 1],
    scaleY: [0.96, 1],
    translateY: ["4px", "0px"],
    ease: springs.pop,
  })
}
</script>

<template>
  <div
    ref="cardEl"
    class="task-card"
    :class="[`task-card--${color ?? 'mauve'}`, { 'task-card--done': done }]"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
  >
    <div class="task-card__edge" />
    <div class="task-card__body">
      <div class="task-card__meta">
        <span v-if="priority" class="task-card__priority" :class="`priority--${priority}`">
          {{ priority === 'high' ? '●' : priority === 'medium' ? '◉' : '○' }} {{ priority }}
        </span>
        <span v-if="dueDate" class="task-card__due">due {{ dueDate }}</span>
      </div>
      <h4 class="task-card__title">{{ title }}</h4>
      <div v-if="assigneeInitials" class="task-card__footer">
        <span class="task-card__assignee">{{ assigneeInitials }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-card {
  position: relative;
  padding: var(--space-3) var(--space-5);
  border-radius: var(--radius-md);
  background: var(--color-bgElevated);
  overflow: hidden;
  cursor: pointer;
  user-select: none;
  touch-action: manipulation;
  will-change: transform;
}

.task-card--peach { box-shadow: 0 3px 0 0 var(--color-peach-dark), 0 8px 24px -4px var(--shadow-drop), inset 0 2px 6px var(--shadow-shine), inset 0 -2px 5px var(--shadow-inner); }
.task-card--sage  { box-shadow: 0 3px 0 0 var(--color-sage-dark),  0 8px 24px -4px var(--shadow-drop), inset 0 2px 6px var(--shadow-shine), inset 0 -2px 5px var(--shadow-inner); }
.task-card--mauve { box-shadow: 0 3px 0 0 var(--color-mauve-dark), 0 8px 24px -4px var(--shadow-drop), inset 0 2px 6px var(--shadow-shine), inset 0 -2px 5px var(--shadow-inner); }
.task-card--plum  { box-shadow: 0 3px 0 0 var(--color-plum-dark),  0 8px 24px -4px var(--shadow-drop), inset 0 2px 6px var(--shadow-shine), inset 0 -2px 5px var(--shadow-inner); }
.task-card--sky   { box-shadow: 0 3px 0 0 var(--color-sky-dark),   0 8px 24px -4px var(--shadow-drop), inset 0 2px 6px var(--shadow-shine), inset 0 -2px 5px var(--shadow-inner); }

.task-card:hover:not(.task-card--done) {
  transform: translateY(-2px);
}

.task-card--peach:hover:not(.task-card--done) { box-shadow: 0 5px 0 0 var(--color-peach-dark), 0 12px 28px -4px var(--shadow-drop), inset 0 2px 6px var(--shadow-shine), inset 0 -2px 5px var(--shadow-inner); }
.task-card--sage:hover:not(.task-card--done)  { box-shadow: 0 5px 0 0 var(--color-sage-dark),  0 12px 28px -4px var(--shadow-drop), inset 0 2px 6px var(--shadow-shine), inset 0 -2px 5px var(--shadow-inner); }
.task-card--mauve:hover:not(.task-card--done) { box-shadow: 0 5px 0 0 var(--color-mauve-dark), 0 12px 28px -4px var(--shadow-drop), inset 0 2px 6px var(--shadow-shine), inset 0 -2px 5px var(--shadow-inner); }
.task-card--plum:hover:not(.task-card--done)  { box-shadow: 0 5px 0 0 var(--color-plum-dark),  0 12px 28px -4px var(--shadow-drop), inset 0 2px 6px var(--shadow-shine), inset 0 -2px 5px var(--shadow-inner); }
.task-card--sky:hover:not(.task-card--done)   { box-shadow: 0 5px 0 0 var(--color-sky-dark),   0 12px 28px -4px var(--shadow-drop), inset 0 2px 6px var(--shadow-shine), inset 0 -2px 5px var(--shadow-inner); }

.task-card--done {
  opacity: 0.6;
}

.task-card--done .task-card__title {
  text-decoration: line-through;
}

.task-card__edge {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
}

.task-card--peach .task-card__edge { background: var(--color-peach-base); }
.task-card--sage  .task-card__edge { background: var(--color-sage-base); }
.task-card--mauve .task-card__edge { background: var(--color-mauve-base); }
.task-card--plum  .task-card__edge { background: var(--color-plum-base); }
.task-card--sky   .task-card__edge { background: var(--color-sky-base); }

.task-card--done .task-card__edge {
  opacity: 0.4;
}

.task-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.task-card__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-micro-size);
  color: var(--color-textMuted);
}

.priority--high   { color: var(--color-danger); }
.priority--medium { color: var(--color-warning); }
.priority--low    { color: var(--color-textMuted); }

.task-card__title {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.task-card__footer {
  display: flex;
  align-items: center;
}

.task-card__assignee {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  font-size: var(--text-micro-size);
  color: var(--color-textSecondary);
}
</style>

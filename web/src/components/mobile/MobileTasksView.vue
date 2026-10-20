<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import { useTasks, type Task } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { memberColorHex, type MemberColor } from "@/types/household"
import { PhCaretDown, PhCaretRight, PhCheckCircle, PhListChecks } from "@phosphor-icons/vue"

const emit = defineEmits<{ selectTask: [id: string] }>()

const { todos, doing, done, ensureLoaded, loading } = useTasks()
const { members, ensureLoaded: loadMembers } = useMembers()

const openSections = ref<Record<string, boolean>>({
  todo: true,
  doing: true,
  done: false,
})

function toggle(section: string) {
  openSections.value[section] = !openSections.value[section]
}

function assigneeColor(task: Task): string | null {
  if (!task.assigneeId) return null
  const m = members.value.find(mem => mem.id === task.assigneeId)
  if (!m) return null
  return m.color.startsWith("#") ? m.color : memberColorHex(m.color as MemberColor)
}

function assigneeName(task: Task): string | null {
  if (!task.assigneeId) return null
  return members.value.find(mem => mem.id === task.assigneeId)?.name || null
}

const priorityLabels: Record<string, string> = {
  low: "Low priority",
  medium: "Medium priority",
  high: "High priority",
}

const priorityDots: Record<string, string> = {
  low: "var(--color-textMuted)",
  medium: "var(--color-warning)",
  high: "var(--color-danger)",
}

function formatDue(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

const sections = computed(() => [
  { key: "todo", label: "To do", items: todos.value },
  { key: "doing", label: "In progress", items: doing.value },
  { key: "done", label: "Done", items: done.value },
].filter(section => section.items.length > 0))

const totalTasks = computed(() => todos.value.length + doing.value.length + done.value.length)

onMounted(async () => {
  await Promise.all([loadMembers(), ensureLoaded()])
})
</script>

<template>
  <section class="mobile-tasks" aria-label="Tasks">
    <div v-if="loading && totalTasks === 0" class="mt-loading">
      <p>Loading tasks…</p>
    </div>

    <div v-else-if="totalTasks === 0" class="mt-state">
      <span class="mt-state-icon">
        <PhListChecks :size="24" />
      </span>
      <p class="mt-state-title">No tasks yet</p>
      <p class="mt-state-hint">Tap + to add a task</p>
    </div>

    <div v-else class="mt-sections">
      <div v-for="section in sections" :key="section.key" class="mt-section">
        <button
          class="mt-section-header"
          type="button"
          :aria-expanded="openSections[section.key]"
          @click="toggle(section.key)"
        >
          <component :is="openSections[section.key] ? PhCaretDown : PhCaretRight" :size="16" />
          <span>{{ section.label }}</span>
          <span class="mt-count">{{ section.items.length }}</span>
        </button>

        <div v-if="openSections[section.key]" class="mt-items">
          <button
            v-for="t in section.items"
            :key="t.id"
            class="mt-item"
            :class="{ 'mt-item--done': t.status === 'done' }"
            type="button"
            @click="emit('selectTask', t.id)"
          >
            <PhCheckCircle v-if="t.status === 'done'" :size="16" class="mt-done-icon" />
            <span
              v-else
              class="mt-item-dot"
              :style="{ background: priorityDots[t.priority] ?? 'var(--color-textMuted)' }"
              :title="priorityLabels[t.priority] ?? 'Priority'"
            />
            <span class="mt-item-body">
              <span class="mt-item-title" :class="{ 'mt-item-title--done': t.status === 'done' }">
                {{ t.title }}
              </span>
              <span v-if="t.startAt && t.status !== 'done'" class="mt-item-meta">
                Due {{ formatDue(t.startAt) }}
              </span>
            </span>
            <span
              v-if="assigneeColor(t)"
              class="mt-item-assignee"
              :style="{ background: assigneeColor(t) ?? '' }"
              :title="assigneeName(t) ? `Assigned to ${assigneeName(t)}` : 'Assigned'"
            />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mobile-tasks {
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.mt-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-textSecondary);
  font-size: var(--text-body-size);
}

.mt-sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4) var(--space-4);
}

.mt-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mt-section-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 48px;
  padding: var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-textSecondary);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  text-align: left;
  cursor: pointer;
}

.mt-section-header:active {
  background: var(--color-bgSubtle);
}

.mt-count {
  margin-left: auto;
  font-size: var(--text-label-size);
  color: var(--color-textSecondary);
  background: var(--color-bgSubtle);
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
}

.mt-items {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mt-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 56px;
  padding: var(--space-3) var(--space-4);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-bgElevated);
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  text-align: left;
  cursor: pointer;
  box-shadow:
    0 2px 0 0 var(--color-bgSubtle),
    0 6px 16px -8px var(--shadow-accent-drop),
    inset 0 1px 2px var(--shadow-shine);
  transition: transform var(--duration-fast) cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.mt-item:active {
  transform: translateY(1px) scale(0.995);
  box-shadow: inset 0 2px 6px var(--shadow-accent-drop);
}

.mt-item--done {
  background: color-mix(in srgb, var(--color-bgSubtle) 55%, var(--color-bgElevated));
  box-shadow: 0 2px 0 0 var(--color-bgSubtle);
}

.mt-item-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.mt-item-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.mt-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mt-item-title--done {
  text-decoration: line-through;
  color: var(--color-textSecondary);
}

.mt-item-meta {
  font-size: var(--text-label-size);
  color: var(--color-textSecondary);
}

.mt-item-assignee {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.mt-done-icon {
  flex-shrink: 0;
  color: var(--color-success);
}

.mt-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: 100%;
  padding: var(--space-8) var(--space-6);
  text-align: center;
}

.mt-state-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: var(--space-1);
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  color: var(--color-accent-darker);
}

.mt-state-title {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.mt-state-hint {
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textSecondary);
}

.mt-section-header:focus-visible,
.mt-item:focus-visible {
  outline: 2px solid var(--color-accent-darker);
  outline-offset: 2px;
}
</style>

<script setup lang="ts">
import { ref, onMounted } from "vue"
import { useTasks } from "@/composables/useTasks"
import type { Task } from "@/composables/useTasks"
import { useUi } from "@/composables/useUi"
import { tasksApi } from "@/api/tasks"
import { PhPlus, PhArrowLeft, PhArrowRight } from "@phosphor-icons/vue"
import UiButton from "@/components/ui/UiButton.vue"
import UiBadge from "@/components/ui/UiBadge.vue"
import TaskCard from "@/components/ui/TaskCard.vue"
import PageHeader from "@/components/ui/PageHeader.vue"
import { animate, stagger, springs } from "@/lib/motion"

const { todos, doing, done, loading, ensureLoaded, upsertTask } = useTasks()
const ui = useUi()
ensureLoaded()

async function moveTask(id: string, status: Task["status"]) {
  try {
    const updated = await tasksApi.updateTask(id, { status })
    upsertTask(updated)
  } catch {}
}

const columnsEl = ref<HTMLElement | null>(null)

onMounted(() => {
  const cols = columnsEl.value?.querySelectorAll(".tasks-column")
  if (!cols?.length) return
  animate(cols, {
    opacity: [0, 1],
    translateY: [24, 0],
    ease: springs.enter,
    delay: stagger(80),
  })
})
</script>

<template>
  <div class="tasks-view">
    <PageHeader title="Tasks">
      <template #actions>
        <UiButton @click="ui.openDrawer('quick-add' as any)">
          <PhPlus :size="16" weight="bold" />Add
        </UiButton>
      </template>
    </PageHeader>

    <div ref="columnsEl" class="tasks-columns">
      <!-- To Do -->
      <div class="tasks-column" style="--col: 0">
        <div class="column-header column-header--todo">
          <span class="column-title">To Do</span>
          <Transition name="badge" mode="out-in">
            <UiBadge :key="todos.length">{{ todos.length }}</UiBadge>
          </Transition>
        </div>
        <TransitionGroup tag="div" name="card" class="column-cards">
          <div v-for="(task, i) in todos" :key="task.id" class="card-slot">
            <TaskCard
              :style="{ '--stagger': i }"
              :title="task.title"
              :priority="task.priority"
              :due-date="task.startAt ? new Date(task.startAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : undefined"
              @click="ui.openDrawer('task-detail', task.id)"
            />
            <div class="card-move-controls">
              <button class="move-btn" title="Move to Doing" @click.stop="moveTask(task.id, 'doing')">
                <PhArrowRight :size="12" />
              </button>
            </div>
          </div>
        </TransitionGroup>
      </div>

      <!-- Doing -->
      <div class="tasks-column" style="--col: 1">
        <div class="column-header column-header--doing">
          <span class="column-title">Doing</span>
          <Transition name="badge" mode="out-in">
            <UiBadge :key="doing.length">{{ doing.length }}</UiBadge>
          </Transition>
        </div>
        <TransitionGroup tag="div" name="card" class="column-cards">
          <div v-for="(task, i) in doing" :key="task.id" class="card-slot">
            <TaskCard
              :style="{ '--stagger': i }"
              :title="task.title"
              :priority="task.priority"
              :due-date="task.startAt ? new Date(task.startAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : undefined"
              @click="ui.openDrawer('task-detail', task.id)"
            />
            <div class="card-move-controls">
              <button class="move-btn" title="Move to To Do" @click.stop="moveTask(task.id, 'todo')">
                <PhArrowLeft :size="12" />
              </button>
              <button class="move-btn" title="Move to Done" @click.stop="moveTask(task.id, 'done')">
                <PhArrowRight :size="12" />
              </button>
            </div>
          </div>
        </TransitionGroup>
      </div>

      <!-- Done -->
      <div class="tasks-column" style="--col: 2">
        <div class="column-header column-header--done">
          <span class="column-title">Done</span>
          <Transition name="badge" mode="out-in">
            <UiBadge :key="done.length">{{ done.length }}</UiBadge>
          </Transition>
        </div>
        <TransitionGroup tag="div" name="card" class="column-cards">
          <div v-for="(task, i) in done" :key="task.id" class="card-slot">
            <TaskCard
              :style="{ '--stagger': i }"
              :title="task.title"
              :priority="task.priority"
              :done="true"
              @click="ui.openDrawer('task-detail', task.id)"
            />
            <div class="card-move-controls">
              <button class="move-btn" title="Move to Doing" @click.stop="moveTask(task.id, 'doing')">
                <PhArrowLeft :size="12" />
              </button>
            </div>
          </div>
        </TransitionGroup>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tasks-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tasks-columns {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
  flex: 1;
  overflow: hidden;
}

.tasks-column {
  display: flex;
  flex-direction: column;
  background: var(--color-bgSurface);
  border-radius: var(--radius-md);
  overflow: hidden;
  opacity: 0;
}

.column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 2px solid;
}

.column-header--todo  { border-color: var(--color-mauve-base); }
.column-header--doing { border-color: var(--color-warning); }
.column-header--done  { border-color: var(--color-success); }

.column-title {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
}

.column-cards {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.card-slot {
  position: relative;
}

.card-move-controls {
  position: absolute;
  bottom: var(--space-2);
  right: var(--space-2);
  display: flex;
  gap: var(--space-1);
  opacity: 0;
  transition: opacity var(--duration-fast);
  pointer-events: none;
}

.card-slot:hover .card-move-controls {
  opacity: 1;
  pointer-events: auto;
}

.move-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  min-width: unset;
  min-height: unset;
  border: none;
  border-radius: var(--radius-xs);
  background: var(--color-bgSubtle);
  color: var(--color-textSecondary);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast), transform var(--duration-fast);
}

.move-btn:hover {
  background: var(--color-primary);
  color: var(--color-textInverse);
  transform: scale(1.1);
}

.card-enter-active {
  transition: opacity var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94),
              transform var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94);
  transition-delay: calc(var(--stagger, 0) * 40ms);
}
.card-leave-active {
  transition: opacity var(--duration-fast) ease-in,
              transform var(--duration-fast) ease-in;
}
.card-enter-from { opacity: 0; transform: translateY(12px) scale(0.98); }
.card-leave-to   { opacity: 0; transform: scale(0.96); }
.card-move       { transition: transform var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94); }

.badge-enter-active {
  transition: transform var(--duration-fast) cubic-bezier(0.22, 1, 0.36, 1),
              opacity var(--duration-fast) ease;
}
.badge-leave-active {
  transition: transform 80ms ease-in, opacity 80ms ease-in;
  position: absolute;
}
.badge-enter-from { transform: scale(1.6); opacity: 0; }
.badge-leave-to   { transform: scale(0.5); opacity: 0; }
</style>

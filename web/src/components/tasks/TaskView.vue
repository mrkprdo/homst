<script setup lang="ts">
import { useTasks } from "@/composables/useTasks"
import { useUi } from "@/composables/useUi"
import { PhPlus, PhCheckCircle } from "@phosphor-icons/vue"
import UiButton from "@/components/ui/UiButton.vue"
import UiEmptyState from "@/components/ui/UiEmptyState.vue"
import UiSkeleton from "@/components/ui/UiSkeleton.vue"
import TaskCard from "@/components/ui/TaskCard.vue"
import PageHeader from "@/components/ui/PageHeader.vue"

const { tasks, loading, ensureLoaded } = useTasks()
const ui = useUi()
ensureLoaded()
</script>

<template>
  <div class="task-view">
    <PageHeader title="Tasks">
      <template #actions>
        <UiButton @click="ui.openDrawer('quick-add' as any)">
          <PhPlus :size="16" weight="bold" />Add
        </UiButton>
      </template>
    </PageHeader>

    <div class="task-list">
      <template v-if="loading">
        <UiSkeleton v-for="i in 5" :key="'sk-' + i" :index="i" />
      </template>

      <Transition name="empty">
        <UiEmptyState v-if="tasks.length === 0 && !loading" message="No tasks yet. Create one to get started.">
          <template #icon>
            <PhCheckCircle :size="36" />
          </template>
        </UiEmptyState>
      </Transition>

      <TransitionGroup name="card">
        <TaskCard
          v-for="(task, i) in tasks"
          :key="task.id"
          :style="{ '--stagger': i }"
          :title="task.title"
          :priority="task.priority"
          :due-date="task.startAt ? new Date(task.startAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : undefined"
          :done="task.status === 'done'"
        />
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.task-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  flex: 1;
  overflow-y: auto;
}

.empty-enter-active { transition: opacity var(--duration-slow) ease, transform var(--duration-slow) cubic-bezier(0.25, 0.46, 0.45, 0.94); }
.empty-leave-active { transition: opacity var(--duration-fast) ease; }
.empty-enter-from   { opacity: 0; transform: translateY(10px); }
.empty-leave-to     { opacity: 0; }

.card-enter-active {
  transition: opacity var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94),
              transform var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94);
  transition-delay: calc(var(--stagger, 0) * 40ms);
}
.card-leave-active { transition: opacity var(--duration-fast) ease-in, transform var(--duration-fast) ease-in; }
.card-enter-from   { opacity: 0; transform: translateY(12px) scale(0.98); }
.card-leave-to     { opacity: 0; transform: scale(0.96); }
.card-move         { transition: transform var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94); }
</style>

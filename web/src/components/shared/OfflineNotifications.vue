<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { PhX } from "@phosphor-icons/vue"
import type { StoredPush } from "@/lib/pushStore"

const props = defineProps<{
  items: StoredPush[]
  selected: StoredPush | null
}>()

const emit = defineEmits<{ close: [] }>()

const activeId = ref<string | null>(props.selected?.id ?? props.items[0]?.id ?? null)

watch(
  () => props.selected,
  (selected) => {
    if (selected) activeId.value = selected.id
  },
)

const active = computed(
  () => props.items.find(item => item.id === activeId.value) ?? props.items[0] ?? null,
)
const recent = computed(() => props.items.filter(item => item.id !== active.value?.id))

function formatTime(ts: number): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}
</script>

<template>
  <div class="offline-push" @click.self="emit('close')">
    <div
      class="offline-push__sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="offline-push-title"
      @click.stop
    >
      <header class="offline-push__head">
        <div>
          <p class="offline-push__eyebrow">Received by push</p>
          <h2 class="offline-push__heading">Notifications</h2>
        </div>
        <button class="offline-push__close" type="button" aria-label="Close" @click="emit('close')">
          <PhX :size="20" />
        </button>
      </header>

      <p class="offline-push__hint">
        HOMST's local server is out of reach, so this copy is stored on this device.
        Connect to your home network to open the full app.
      </p>

      <article v-if="active" class="offline-push__card">
        <p class="offline-push__time">{{ formatTime(active.received_at) }}</p>
        <h3 id="offline-push-title" class="offline-push__title">{{ active.title }}</h3>
        <p class="offline-push__body">{{ active.body }}</p>
      </article>

      <p v-else class="offline-push__empty">
        This notification was received, but its text is not stored on this device.
      </p>

      <section v-if="recent.length" class="offline-push__recent" aria-label="Earlier notifications">
        <h3 class="offline-push__recent-title">Earlier notifications</h3>
        <button
          v-for="item in recent"
          :key="item.id"
          type="button"
          class="offline-push__recent-item"
          @click="activeId = item.id"
        >
          <span class="offline-push__recent-name">{{ item.title }}</span>
          <span class="offline-push__recent-body">{{ item.body }}</span>
          <span class="offline-push__recent-time">{{ formatTime(item.received_at) }}</span>
        </button>
      </section>

      <footer class="offline-push__foot">
        <p>Push is one-way, so reading this does not need the server.</p>
        <button class="offline-push__done" type="button" @click="emit('close')">Close</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.offline-push {
  position: fixed;
  inset: 0;
  z-index: 10002;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(30, 24, 32, 0.35);
  animation: offline-push-in var(--duration-base) ease both;
}

.offline-push__sheet {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: 92vh;
  max-height: 92dvh;
  padding: var(--space-4) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  background: var(--color-bgElevated);
  box-shadow: 0 -10px 40px -16px rgba(0, 0, 0, 0.35);
  overflow-y: auto;
}

.offline-push__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.offline-push__eyebrow {
  margin: 0;
  font-size: var(--text-micro-size);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-warning, #caa681);
}

.offline-push__heading {
  margin: 2px 0 0;
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.offline-push__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textSecondary);
  cursor: pointer;
}

.offline-push__close:focus-visible,
.offline-push__recent-item:focus-visible,
.offline-push__done:focus-visible {
  outline: 2px solid var(--color-accent-darker);
  outline-offset: 2px;
}

.offline-push__hint {
  margin: var(--space-2) 0 var(--space-4);
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textMuted);
}

.offline-push__card {
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-left: 4px solid var(--color-warning, #caa681);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
}

.offline-push__time {
  margin: 0 0 var(--space-1);
  font-size: var(--text-micro-size);
  color: var(--color-textMuted);
}

.offline-push__title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.offline-push__body {
  margin: 0;
  font-size: var(--text-body-size);
  line-height: 1.55;
  color: var(--color-textSecondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.offline-push__empty {
  margin: 0;
  padding: var(--space-4);
  border: 1px dashed var(--color-borderStrong);
  border-radius: var(--radius-sm);
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textMuted);
}

.offline-push__recent {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-5);
}

.offline-push__recent-title {
  margin: 0;
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textMuted);
}

.offline-push__recent-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  font-family: var(--font-family);
  text-align: left;
  cursor: pointer;
}

.offline-push__recent-item:active {
  background: var(--color-bgSubtle);
}

.offline-push__recent-name {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.offline-push__recent-body {
  font-size: var(--text-label-size);
  color: var(--color-textSecondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline-push__recent-time {
  font-size: var(--text-micro-size);
  color: var(--color-textMuted);
}

.offline-push__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-5);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.offline-push__foot p {
  margin: 0;
  font-size: var(--text-micro-size);
  line-height: 1.4;
  color: var(--color-textMuted);
}

.offline-push__done {
  flex-shrink: 0;
  min-height: 44px;
  padding: 0 var(--space-5);
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-accent-lighter);
  color: var(--color-accent-darker);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

@keyframes offline-push-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (min-width: 640px) {
  .offline-push {
    align-items: center;
    padding: var(--space-4);
  }

  .offline-push__sheet {
    border-radius: var(--radius-xl);
    max-height: min(720px, 88vh);
  }
}
</style>

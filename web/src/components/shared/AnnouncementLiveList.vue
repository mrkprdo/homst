<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import { PhMegaphone, PhTrash } from "@phosphor-icons/vue"
import {
  useAnnouncements,
  isAnnouncementActive,
  type Announcement,
} from "@/composables/useAnnouncements"

defineProps<{ pane?: boolean }>()

const { announcements, ensureLoaded, remove } = useAnnouncements()

const now = ref(Date.now())
const removingId = ref<string | null>(null)
const error = ref("")

let clock: ReturnType<typeof setInterval> | undefined

const active = computed(() =>
  announcements.value.filter(a => isAnnouncementActive(a, now.value)),
)

onMounted(() => {
  void ensureLoaded()
  clock = setInterval(() => { now.value = Date.now() }, 15_000)
})

onUnmounted(() => {
  if (clock) clearInterval(clock)
})

async function removeItem(id: string) {
  if (removingId.value) return
  removingId.value = id
  error.value = ""
  try {
    await remove(id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not remove the announcement"
  } finally {
    removingId.value = null
  }
}

function relativeTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "just now"
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function authorLabel(a: Announcement): string {
  return a.authorName || "Household"
}

function expiryLabel(a: Announcement): string {
  if (!a.expiresAt) return "until removed"

  const expires = new Date(a.expiresAt)
  if (Number.isNaN(expires.getTime())) return "until removed"

  const remaining = expires.getTime() - now.value
  if (remaining <= 0) return "expired"

  const minutes = Math.ceil(remaining / 60_000)
  if (minutes < 60) return `expires in ${minutes} min`

  const hours = Math.ceil(minutes / 60)
  if (hours < 24) return `expires in ${hours} h`

  return `until ${expires.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
}
</script>

<template>
  <section
    class="announcement-live"
    :class="{ 'announcement-live--pane': pane }"
    aria-label="Active announcements"
  >
    <div class="announcement-live__head">
      <h2 class="announcement-live__title">On every screen now</h2>
      <span v-if="active.length" class="announcement-live__count">
        {{ active.length }} live
      </span>
    </div>

    <ul v-if="active.length" class="announcement-live__list">
      <li v-for="a in active" :key="a.id" class="announcement-live__item">
        <span class="announcement-live__dot" aria-hidden="true" />
        <div class="announcement-live__copy">
          <p class="announcement-live__message">{{ a.message }}</p>
          <p class="announcement-live__meta">
            {{ authorLabel(a) }} · {{ relativeTime(a.createdAt) }} · {{ expiryLabel(a) }}
          </p>
        </div>
        <button
          class="announcement-live__remove"
          type="button"
          :disabled="removingId === a.id"
          :aria-label="`Remove announcement: ${a.message}`"
          title="Remove from every screen"
          @click="removeItem(a.id)"
        >
          <PhTrash :size="17" />
        </button>
      </li>
    </ul>

    <div v-else class="announcement-live__empty">
      <span class="announcement-live__empty-icon" aria-hidden="true">
        <PhMegaphone :size="22" />
      </span>
      <div>
        <p class="announcement-live__empty-title">Nothing on the screens right now.</p>
        <p class="announcement-live__empty-desc">
          Announcements you send appear here until they expire.
        </p>
      </div>
    </div>

    <p v-if="error" class="announcement-live__error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.announcement-live {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
}

.announcement-live--pane {
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-bgElevated);
}

.announcement-live__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.announcement-live__title {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.announcement-live__count {
  flex-shrink: 0;
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-accent-lighter);
  color: var(--color-ink, #15171c);
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  font-variant-numeric: tabular-nums;
}

.announcement-live__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.announcement-live__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-border);
}

.announcement-live__item:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.announcement-live__dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-accent-lighter);
}

.announcement-live__copy {
  min-width: 0;
  flex: 1;
}

.announcement-live__message {
  font-size: var(--text-body-size);
  line-height: 1.4;
  color: var(--color-textPrimary);
  overflow-wrap: anywhere;
}

.announcement-live__meta {
  margin-top: 2px;
  font-size: var(--text-micro-size);
  color: var(--color-textMuted);
  font-variant-numeric: tabular-nums;
}

.announcement-live__remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  min-width: unset;
  min-height: unset;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textMuted);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.announcement-live__remove:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
}

.announcement-live__remove:disabled {
  opacity: 0.4;
  cursor: default;
}

.announcement-live__remove:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.announcement-live__empty {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0 var(--space-1);
}

.announcement-live__empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--color-accent-lighter);
  color: var(--color-ink, #15171c);
}

.announcement-live__empty-title {
  font-size: var(--text-body-size);
  color: var(--color-textSecondary);
}

.announcement-live__empty-desc {
  max-width: 34ch;
  margin-top: 2px;
  font-size: var(--text-label-size);
  line-height: 1.45;
  color: var(--color-textMuted);
}

.announcement-live__error {
  margin-top: auto;
  padding-top: var(--space-2);
  font-size: var(--text-label-size);
  color: var(--color-danger);
}

@media (min-width: 1000px) {
  .announcement-live--pane {
    height: 100%;
    min-height: 0;
  }

  .announcement-live--pane .announcement-live__head {
    flex-shrink: 0;
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--color-border);
  }

  .announcement-live--pane .announcement-live__title {
    font-size: var(--text-heading-size);
  }

  .announcement-live--pane .announcement-live__list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: var(--space-1);
  }

  .announcement-live--pane .announcement-live__empty {
    flex: 1;
    min-height: 0;
    flex-direction: column;
    justify-content: center;
    padding: var(--space-5);
    text-align: center;
  }

  .announcement-live--pane .announcement-live__empty-icon {
    width: 56px;
    height: 56px;
  }

  .announcement-live--pane .announcement-live__empty-title {
    font-size: var(--text-heading-size);
  }

  .announcement-live--pane .announcement-live__empty-desc {
    margin-inline: auto;
  }
}
</style>

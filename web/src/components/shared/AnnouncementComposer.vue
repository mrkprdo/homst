<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import { PhMegaphone, PhPaperPlaneTilt } from "@phosphor-icons/vue"
import { useMembers } from "@/composables/useMembers"
import { useAnnouncements } from "@/composables/useAnnouncements"
import { isServerUnreachable } from "@/api/client"
import {
  SERVER_UNREACHABLE_DETAIL,
  SERVER_UNREACHABLE_TITLE,
  useServerReachability,
} from "@/composables/useServerReachability"
import UiButton from "@/components/ui/UiButton.vue"
import UiSelect from "@/components/ui/UiSelect.vue"
import UiTextarea from "@/components/ui/UiTextarea.vue"
import UiToggle from "@/components/ui/UiToggle.vue"

defineProps<{ fill?: boolean }>()

const { send } = useAnnouncements()
const { members, ensureLoaded: ensureMembersLoaded } = useMembers()
const { serverReachable } = useServerReachability()

const message = ref("")
const authorId = ref("")
const duration = ref("30")
const notifyPhones = ref(true)
const sending = ref(false)
const error = ref("")
const sent = ref(false)
/** The request never reached the server, so this is a notice, not an error. */
const unreachable = ref(false)

let sentTimer: ReturnType<typeof setTimeout> | undefined

const canSend = computed(() => message.value.trim().length > 0 && !sending.value)

const DURATIONS = [
  { value: "5", label: "5 minutes" },
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "240", label: "4 hours" },
  { value: "1440", label: "1 day" },
  { value: "never", label: "Until dismissed" },
]

function defaultAuthor() {
  if (authorId.value || members.value.length === 0) return
  authorId.value = members.value[0]!.id
}

onMounted(async () => {
  await ensureMembersLoaded()
  defaultAuthor()
})

watch(serverReachable, (reachable) => {
  if (reachable) unreachable.value = false
})

onUnmounted(() => {
  if (sentTimer) clearTimeout(sentTimer)
})

async function submit() {
  const text = message.value.trim()
  if (!text || sending.value) return

  sending.value = true
  error.value = ""
  unreachable.value = false
  try {
    await send({
      message: text,
      createdBy: authorId.value || null,
      durationMinutes: duration.value === "never" ? null : Number(duration.value),
      sendPush: notifyPhones.value,
    })
    message.value = ""
    sent.value = true
    if (sentTimer) clearTimeout(sentTimer)
    sentTimer = setTimeout(() => { sent.value = false }, 4000)
  } catch (err) {
    if (isServerUnreachable(err)) {
      unreachable.value = true
    } else {
      error.value = err instanceof Error ? err.message : "Could not send the announcement"
    }
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="announcement-composer" :class="{ 'announcement-composer--fill': fill }">
    <form class="ac-form" @submit.prevent="submit">
      <div class="ac-field ac-field--message">
        <label class="ac-label" for="announcement-message">Message</label>
        <UiTextarea
          id="announcement-message"
          v-model="message"
          :rows="3"
          :maxlength="500"
          :disabled="sending"
          placeholder="Dinner is ready — come to the kitchen."
        />
        <span class="ac-counter">{{ message.length }}/500</span>
      </div>

      <div class="ac-options">
        <label class="ac-field">
          <span class="ac-label">From</span>
          <UiSelect v-model="authorId" :disabled="sending">
            <option value="">Household</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name }}</option>
          </UiSelect>
        </label>

        <label class="ac-field">
          <span class="ac-label">Show for</span>
          <UiSelect v-model="duration" :disabled="sending">
            <option v-for="opt in DURATIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </UiSelect>
        </label>
      </div>

      <div class="ac-notify">
        <div>
          <p class="ac-row-title">Notify phones</p>
          <p class="ac-row-desc">Also send a push notification to subscribed devices.</p>
        </div>
        <UiToggle v-model="notifyPhones" />
      </div>

      <div class="ac-actions">
        <p v-if="sent" class="ac-sent" role="status">
          <PhMegaphone :size="16" weight="fill" />Announcement sent to every screen.
        </p>
        <UiButton type="submit" :disabled="!canSend">
          <PhPaperPlaneTilt :size="16" weight="fill" />
          {{ sending ? "Sending…" : "Send announcement" }}
        </UiButton>
      </div>

      <p v-if="unreachable || !serverReachable" class="ac-notice" role="status">
        <strong>{{ SERVER_UNREACHABLE_TITLE }}.</strong>
        {{ SERVER_UNREACHABLE_DETAIL }}
      </p>
      <p v-if="error" class="ac-error" role="alert">{{ error }}</p>
    </form>
  </div>
</template>

<style scoped>
.announcement-composer {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.ac-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.ac-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.ac-label {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textMuted);
}

.ac-counter {
  align-self: flex-end;
  font-size: var(--text-micro-size);
  color: var(--color-textMuted);
  font-variant-numeric: tabular-nums;
}

.ac-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.ac-notify {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
}

.ac-row-title {
  font-size: var(--text-body-size);
  color: var(--color-textPrimary);
}

.ac-row-desc {
  margin-top: 2px;
  font-size: var(--text-label-size);
  line-height: 1.45;
  color: var(--color-textMuted);
}

.ac-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.ac-sent {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-right: auto;
  font-size: var(--text-label-size);
  color: var(--color-success, #6f7a58);
}

.ac-notice {
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--color-warning, #caa681);
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--color-warning, #caa681) 12%, transparent);
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  line-height: 1.5;
}

.ac-notice strong {
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.ac-error {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
  font-size: var(--text-label-size);
}

/* Fill the left pane on wide screens so the composer owns the full height. */
@media (min-width: 1000px) {
  .announcement-composer--fill {
    flex: 1;
    min-height: 0;
  }

  .announcement-composer--fill .ac-form {
    flex: 1;
    min-height: 0;
  }

  .announcement-composer--fill .ac-field--message {
    flex: 1;
    min-height: 0;
  }

  .announcement-composer--fill .ac-field--message :deep(.ui-textarea) {
    flex: 1;
    resize: none;
  }

  .announcement-composer--fill .ac-actions {
    margin-top: auto;
  }
}

@media (max-width: 560px) {
  .ac-options {
    grid-template-columns: 1fr;
  }

  .ac-actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .ac-actions :deep(.ui-btn) {
    width: 100%;
  }

  .ac-sent {
    margin-right: 0;
    justify-content: center;
  }
}
</style>

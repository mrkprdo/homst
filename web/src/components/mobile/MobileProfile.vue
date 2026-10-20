<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"
import { useMembers } from "@/composables/useMembers"
import { usePush } from "@/composables/usePush"
import { notificationsApi } from "@/api/notifications"
import { isServerUnreachable } from "@/api/client"
import {
  SERVER_UNREACHABLE_DETAIL,
  SERVER_UNREACHABLE_TITLE,
  useServerReachability,
} from "@/composables/useServerReachability"
import { memberColorHex, type MemberColor } from "@/types/household"
import { readableTextOn } from "@/utils/color"
import { PhX, PhUser, PhBell, PhDownloadSimple } from "@phosphor-icons/vue"
import UiToggle from "@/components/ui/UiToggle.vue"

const emit = defineEmits<{ close: [] }>()

const { members, ensureLoaded } = useMembers()

const {
  supported: pushSupported,
  subscribed: pushSubscribed,
  busy: pushBusy,
  error: pushError,
  supportDetail: pushSupportDetail,
  refresh: refreshPush,
  enable: enablePush,
  disable: disablePush,
} = usePush()

const testing = ref(false)
const testResults = ref<Record<string, string> | null>(null)
const testUnreachable = ref(false)
const { serverReachable } = useServerReachability()

onMounted(async () => {
  refreshPush()
  await ensureLoaded()
})

watch(serverReachable, (reachable) => {
  if (reachable) testUnreachable.value = false
})

/** Toggling turns *this* device's push subscription on or off. */
async function onPushToggle(enabled: boolean) {
  testResults.value = null
  if (enabled) await enablePush()
  else await disablePush()
}

/** Fire a reminder at every client: all open screens (HUD) and all phones (push). */
async function sendTestPush() {
  testing.value = true
  testResults.value = null
  testUnreachable.value = false
  try {
    const res = await notificationsApi.sendTest({ channels: ["hud", "push"] })
    testResults.value = res.results
  } catch (err) {
    if (isServerUnreachable(err)) {
      testUnreachable.value = true
    } else {
      testResults.value = { hud: "failed: could not send the test" }
    }
  } finally {
    testing.value = false
  }
}

const CHANNEL_LABELS: Record<string, string> = { hud: "Screens", push: "Phones" }

const currentMember = computed(() => members.value[0])

function memberHex(member: typeof currentMember.value) {
  if (!member) return "#b1b695"
  return member.color?.startsWith("#") ? member.color : memberColorHex((member.color || "sage-base") as MemberColor)
}

const avatarText = computed(() => readableTextOn(memberHex(currentMember.value)))

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  })
}
</script>

<template>
  <div class="mobile-profile" @click.self="emit('close')">
    <div class="mp-sheet" role="dialog" aria-modal="true" aria-label="Profile" @click.stop>
      <div class="mp-handle" />
      <div class="mp-header">
        <h3>Profile</h3>
        <button class="mp-close" @click="emit('close')" aria-label="Close">
          <PhX :size="20" />
        </button>
      </div>

      <div class="mp-body">
        <div v-if="members.length > 0">
          <div class="mp-avatar" :style="{ background: memberHex(currentMember) }">
            <span class="mp-avatar-letter" :style="{ color: avatarText }">
              {{ (currentMember?.name || "?")[0]?.toUpperCase() }}
            </span>
          </div>
          <h2 class="mp-name">{{ currentMember?.name || "Unnamed" }}</h2>
          <p class="mp-role">{{ currentMember?.role === "admin" ? "Admin" : "Member" }}</p>
          <p v-if="currentMember?.joinedAt" class="mp-joined">Joined {{ formatDate(currentMember.joinedAt) }}</p>
        </div>

        <div v-else class="mp-empty">
          <PhUser :size="32" />
          <p>No member info</p>
        </div>

        <div class="mp-section">
          <p class="mp-section-label">Household members</p>
          <div v-for="m in members" :key="m.id" class="mp-member-row">
            <span class="mp-member-dot" :style="{ background: memberHex(m) }" />
            <span class="mp-member-name">{{ m.name }}</span>
            <span v-if="m.role === 'admin'" class="mp-badge">Admin</span>
          </div>
        </div>

        <div class="mp-section">
          <p class="mp-section-label">Notifications</p>
          <div class="mp-row">
            <div class="mp-row-text">
              <span class="mp-row-title">Reminders on this phone</span>
              <span class="mp-row-desc">
                <template v-if="pushSubscribed">On — reminders arrive even when HOMST is closed</template>
                <template v-else-if="pushSupported">Get reminders on this phone even when it is closed</template>
                <template v-else>{{ pushSupportDetail || "This browser can't receive push" }}</template>
              </span>
            </div>
            <UiToggle
              :model-value="pushSubscribed"
              :disabled="!pushSupported || pushBusy"
              @update:model-value="onPushToggle"
            />
          </div>

          <p v-if="pushError" class="mp-error">{{ pushError }}</p>

          <button class="mp-test-btn" :disabled="testing" @click="sendTestPush">
            <PhBell :size="16" />
            {{ testing ? "Sending…" : "Send test to all clients" }}
          </button>
          <div v-if="testResults" class="mp-test-results">
            <p v-for="(detail, channel) in testResults" :key="channel" class="mp-test-result">
              <strong>{{ CHANNEL_LABELS[channel] ?? channel }}:</strong> {{ detail }}
            </p>
          </div>
          <p v-if="testUnreachable || !serverReachable" class="mp-notice" role="status">
            <strong>{{ SERVER_UNREACHABLE_TITLE }}.</strong>
            {{ SERVER_UNREACHABLE_DETAIL }}
          </p>
        </div>

        <div class="mp-section">
          <p class="mp-section-label">Device setup</p>
          <div class="mp-row">
            <div class="mp-row-text">
              <span class="mp-row-title">HTTPS certificate</span>
              <span class="mp-row-desc">Trust this server before install &amp; push work</span>
            </div>
            <a class="mp-link-btn" href="/ca.pem" download="homst-ca.pem">
              <PhDownloadSimple :size="14" />Download
            </a>
          </div>
          <p class="mp-hint">
            Install it as a <strong>CA certificate</strong> (Android: Settings → Security &amp;
            privacy → Encryption &amp; credentials → Install a certificate → CA certificate).
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mobile-profile {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(30, 24, 32, 0.3);
}

:global(.dark) .mobile-profile {
  background: rgba(0, 0, 0, 0.55);
}

.mp-sheet {
  width: 100%;
  max-height: 90vh;
  max-height: 90dvh;
  background: var(--color-bgElevated);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  display: flex;
  flex-direction: column;
  box-shadow: 0 -10px 40px -16px rgba(0, 0, 0, 0.35);
  animation: slide-up var(--duration-slow) cubic-bezier(0.2, 0.7, 0.3, 1) both;
}

@keyframes slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.mp-handle {
  width: 40px;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--color-borderStrong);
  margin: var(--space-2) auto var(--space-1);
  flex-shrink: 0;
}

.mp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-4) var(--space-1);
  border-bottom: 1px solid var(--color-border);
}

.mp-header h3 {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
}

.mp-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  min-width: 48px;
  min-height: 48px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textSecondary);
  cursor: pointer;
}

.mp-body {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-4) var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}

.mp-avatar {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 2px 0 0 var(--color-borderStrong),
    0 6px 16px -8px var(--shadow-accent-drop),
    inset 0 1px 2px var(--shadow-shine);
}

.mp-avatar-letter {
  font-size: var(--text-title-size);
  font-weight: var(--font-weight-medium);
}

.mp-name {
  font-size: var(--text-title-size);
  font-weight: 400;
  text-align: center;
}

.mp-role {
  font-size: var(--text-label-size);
  color: var(--color-textSecondary);
}

.mp-joined {
  font-size: var(--text-micro-size);
  color: var(--color-textSecondary);
}

.mp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-textSecondary);
}

.mp-section {
  width: 100%;
  margin-top: var(--space-4);
}

.mp-section-label {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textSecondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: var(--space-1);
}

.mp-member-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-border);
}

.mp-member-row:last-child {
  border-bottom: none;
}

.mp-member-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.mp-member-name {
  flex: 1;
  font-size: var(--text-body-size);
}

.mp-badge {
  font-size: var(--text-micro-size);
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  color: var(--color-textSecondary);
}

/* ── Notifications / device setup rows ── */
.mp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
}

.mp-row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mp-row-title {
  font-size: var(--text-body-size);
  color: var(--color-textPrimary);
}

.mp-row-desc {
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textSecondary);
}

.mp-error {
  margin-top: var(--space-2);
  font-size: var(--text-label-size);
  color: var(--color-danger);
}

.mp-test-btn,
.mp-link-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-height: 48px;
  flex-shrink: 0;
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-accent-lighter);
  color: var(--color-accent-darker);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--duration-fast);
}

.mp-test-btn:active,
.mp-link-btn:active {
  background: var(--color-accent-light);
}

.mp-test-btn {
  width: 100%;
  margin-top: var(--space-3);
}

.mp-test-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.mp-test-results {
  margin-top: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
}

.mp-test-result {
  font-size: var(--text-label-size);
  color: var(--color-textSecondary);
}

.mp-notice {
  margin-top: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--color-warning, #caa681);
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--color-warning, #caa681) 12%, transparent);
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  line-height: 1.5;
  text-align: left;
}

.mp-notice strong {
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.mp-hint {
  margin-top: var(--space-2);
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textSecondary);
}

.mp-close:focus-visible,
.mp-test-btn:focus-visible,
.mp-link-btn:focus-visible {
  outline: 2px solid var(--color-accent-darker);
  outline-offset: 2px;
}
</style>

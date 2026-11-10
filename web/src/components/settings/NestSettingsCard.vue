<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { PhArrowSquareOut, PhCheckCircle, PhThermometer, PhWarningCircle } from "@phosphor-icons/vue"
import UiButton from "@/components/ui/UiButton.vue"
import UiInput from "@/components/ui/UiInput.vue"
import UiSelect from "@/components/ui/UiSelect.vue"
import UiTextarea from "@/components/ui/UiTextarea.vue"
import { nestApi } from "@/api/nest"
import { useNest } from "@/composables/useNest"

const { status, refresh, applyStatus } = useNest()

const accountType = ref<"google" | "nest">("google")
const issueToken = ref("")
const cookies = ref("")
const accessToken = ref("")
const saving = ref(false)
const message = ref("")
const error = ref("")

watch(status, (value) => {
  if (value?.authType === "google" || value?.authType === "nest") {
    accountType.value = value.authType
  }
}, { immediate: true })

const statusTone = computed(() => {
  if (!status.value?.configured) return "idle"
  if (status.value.connected) return "ok"
  return "error"
})

const statusText = computed(() => {
  if (!status.value) return "Not checked yet."
  if (!status.value.configured) return "Not connected yet."
  if (status.value.connected) {
    const count = status.value.rooms.length
    return `Connected — ${count} room${count === 1 ? "" : "s"}`
  }
  return status.value.error || "Nest is not responding."
})

async function save() {
  saving.value = true
  message.value = ""
  error.value = ""
  try {
    const result = accountType.value === "google"
      ? await nestApi.saveCredentials({
          account_type: "google",
          issue_token: issueToken.value,
          cookies: cookies.value,
        })
      : await nestApi.saveCredentials({
          account_type: "nest",
          access_token: accessToken.value,
        })
    applyStatus(result)
    if (result.configured && result.connected) {
      message.value = "Nest connected. The card will update every minute."
      issueToken.value = ""
      cookies.value = ""
      accessToken.value = ""
    } else {
      error.value = result.error || "Nest did not accept the credentials."
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not save the Nest credentials."
  } finally {
    saving.value = false
  }
}

async function disconnect() {
  saving.value = true
  message.value = ""
  error.value = ""
  try {
    await nestApi.clearCredentials()
    await refresh(true)
    message.value = "Nest disconnected."
    issueToken.value = ""
    cookies.value = ""
    accessToken.value = ""
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not disconnect Nest."
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="settings-card settings-card--nest nest-settings">
    <header class="card-header">
      <div class="card-heading">
        <h3 class="card-title">Indoor temperatures</h3>
        <p class="card-desc">Show Nest thermostat and sensor readings on the home screen</p>
      </div>
    </header>

    <div class="card-body">
      <div class="nest-status" :class="`nest-status--${statusTone}`">
        <PhCheckCircle v-if="statusTone === 'ok'" :size="16" weight="fill" />
        <PhWarningCircle v-else-if="statusTone === 'error'" :size="16" />
        <PhThermometer v-else :size="16" />
        <span>{{ statusText }}</span>
      </div>

      <div class="setting-row setting-row--stack">
        <div class="row-copy">
          <p class="row-title">Account type</p>
          <p class="row-desc">Use Google for accounts migrated to Google Home</p>
        </div>
        <UiSelect v-model="accountType" class="nest-select">
          <option value="google">Google account</option>
          <option value="nest">Legacy Nest account</option>
        </UiSelect>
      </div>

      <template v-if="accountType === 'google'">
        <div class="setting-row setting-row--stack">
          <div class="row-copy">
            <p class="row-title">Issue token</p>
            <p class="row-desc">The full <code>iframerpc</code> request URL from home.nest.com</p>
          </div>
          <UiTextarea
            v-model="issueToken"
            class="nest-textarea"
            :rows="2"
            placeholder="https://accounts.google.com/o/oauth2/iframerpc?action=issueToken&..."
            :disabled="saving"
          />
        </div>

        <div class="setting-row setting-row--stack">
          <div class="row-copy">
            <p class="row-title">Cookies</p>
            <p class="row-desc">The <code>Cookie</code> request header from the same request</p>
          </div>
          <UiTextarea
            v-model="cookies"
            class="nest-textarea"
            :rows="3"
            placeholder="SID=...; HSID=...; SSID=...; ..."
            :disabled="saving"
          />
        </div>

        <details class="nest-help">
          <summary class="nest-help__summary">
            How to get these from Firefox
            <PhArrowSquareOut :size="13" />
          </summary>
          <ol class="nest-help__steps">
            <li>Open a <strong>Firefox private window</strong> and sign in at home.nest.com.</li>
            <li>Open Developer Tools → Network, then filter for <code>issueToken</code>.</li>
            <li>Copy the <code>iframerpc</code> request URL — this is the <strong>Issue token</strong>.</li>
            <li>Open that request and copy the whole <code>Cookie</code> request header.</li>
            <li>Paste both above, save, then close the private window without signing out.</li>
          </ol>
          <p class="nest-help__note">
            Use Firefox, not Chrome or Edge: Chromium ties sign-in sessions to the device,
            so copied cookies stop working within hours.
          </p>
        </details>
      </template>

      <div v-else class="setting-row setting-row--stack">
        <div class="row-copy">
          <p class="row-title">Access token</p>
          <p class="row-desc">From <code>home.nest.com/session</code> on a legacy Nest account</p>
        </div>
        <UiInput
          v-model="accessToken"
          type="password"
          class="nest-input"
          placeholder="b..."
          :disabled="saving"
        />
      </div>

      <div class="nest-actions">
        <UiButton size="sm" :disabled="saving" @click="save">
          {{ saving ? "Saving…" : "Save & test" }}
        </UiButton>
        <UiButton
          v-if="!status"
          size="sm"
          variant="ghost"
          :disabled="saving"
          @click="refresh()"
        >
          Check connection
        </UiButton>
        <UiButton
          v-if="status?.configured"
          size="sm"
          variant="ghost"
          :disabled="saving"
          @click="disconnect"
        >
          Disconnect
        </UiButton>
      </div>

      <p v-if="message" class="nest-message" role="status">{{ message }}</p>
      <p v-if="error" class="nest-error" role="alert">{{ error }}</p>
    </div>

    <p class="card-foot">
      Credentials stay on the server and are never sent back to displays.
      Readings refresh once a minute. Google rotates some session cookies, so
      HOMST saves the new values automatically.
    </p>
  </section>
</template>

<style scoped>
.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.card-heading {
  min-width: 0;
}

.card-title {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  line-height: var(--text-heading-line-height);
  color: var(--color-textPrimary);
}

.card-desc {
  margin-top: 2px;
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textSecondary);
  max-width: 58ch;
}

.card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.card-foot {
  font-size: var(--text-label-size);
  line-height: 1.55;
  color: var(--color-textSecondary);
  max-width: 70ch;
}

.nest-status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-xs);
  font-size: var(--text-label-size);
  line-height: 1.4;
}

.nest-status--idle {
  color: var(--color-textSecondary);
  background: var(--color-bgSubtle);
}

.nest-status--ok {
  color: var(--color-textPrimary);
  background: color-mix(in srgb, var(--color-primary) 16%, var(--color-bgSurface));
}

.nest-status--error {
  color: var(--color-danger, #a87781);
  background: color-mix(in srgb, var(--color-danger, #a87781) 12%, var(--color-bgSurface));
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 48px;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.setting-row--stack {
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
}

.row-copy {
  min-width: 0;
}

.row-title {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.35;
  color: var(--color-textPrimary);
}

.row-desc {
  margin-top: 2px;
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textSecondary);
  max-width: 56ch;
}

.row-desc code,
.nest-help code {
  font-size: 0.95em;
  color: var(--color-textPrimary);
}

.nest-select {
  max-width: 16rem;
}

.nest-input,
.nest-textarea {
  width: 100%;
}

.nest-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.nest-message,
.nest-error {
  font-size: var(--text-label-size);
  line-height: 1.5;
}

.nest-message {
  color: var(--color-textSecondary);
}

.nest-error {
  color: var(--color-danger, #a87781);
}

.nest-help {
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-3);
}

.nest-help__summary {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
  cursor: pointer;
}

.nest-help__steps {
  margin: var(--space-2) 0 0;
  padding-left: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textSecondary);
}

.nest-help__note {
  margin-top: var(--space-2);
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textSecondary);
}
</style>

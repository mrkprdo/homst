<script setup lang="ts">
import { onMounted, onUnmounted } from "vue"
import { PhDownloadSimple, PhWarningCircle } from "@phosphor-icons/vue"
import UiButton from "@/components/ui/UiButton.vue"
import { stopUpdatePromptPolling, useUpdatePrompt } from "@/composables/useUpdatePrompt"

const { prompt, busy, installing, error, accept, decline, refresh } = useUpdatePrompt()

onMounted(() => {
  void refresh()
})

onUnmounted(() => {
  stopUpdatePromptPolling()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="update-prompt">
      <div
        v-if="prompt"
        class="update-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-prompt-title"
      >
        <div class="update-prompt__dialog">
          <div class="update-prompt__icon" :class="{ 'update-prompt__icon--installing': installing }">
            <PhDownloadSimple v-if="!installing" :size="30" weight="duotone" />
            <span v-else class="update-prompt__spinner" />
          </div>

          <div class="update-prompt__body">
            <h2 id="update-prompt-title" class="update-prompt__title">
              {{ installing ? `Installing HOMST ${prompt.version}` : "New version available" }}
            </h2>
            <p class="update-prompt__copy">
              {{
                installing
                  ? "HOMST is downloading the update and will restart in a moment. This screen will reconnect automatically."
                  : `HOMST ${prompt.version} is ready to install. Do you want to install it now?`
              }}
            </p>
            <p v-if="!installing && prompt.major" class="update-prompt__major">
              <PhWarningCircle :size="17" />
              This is a major update. Review the release notes and back up first.
            </p>
            <p v-if="!installing" class="update-prompt__hint">
              Choosing No hides this reminder. You can still install it later from Settings → Software update.
            </p>
            <p v-if="error" class="update-prompt__error" role="alert">{{ error }}</p>
          </div>

          <div v-if="!installing" class="update-prompt__actions">
            <UiButton variant="ghost" :disabled="busy" @click="decline">No, not now</UiButton>
            <UiButton :disabled="busy" @click="accept">Yes, install</UiButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.update-prompt {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: color-mix(in srgb, var(--color-bgBase) 40%, transparent);
  backdrop-filter: blur(6px);
}

.update-prompt__dialog {
  width: min(620px, 100%);
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-6);
  background: var(--color-bgElevated);
  border: 2px solid var(--color-primary);
  border-radius: var(--radius-lg);
  box-shadow:
    0 4px 0 0 color-mix(in srgb, var(--color-primary) 35%, transparent),
    0 24px 64px -12px color-mix(in srgb, var(--color-primary) 45%, transparent),
    inset 0 1px 2px var(--shadow-shine);
}

.update-prompt__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--color-accent-lighter);
  color: var(--color-primary);
}

.update-prompt__icon--installing {
  background: var(--color-bgSubtle);
}

.update-prompt__body {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.update-prompt__title {
  font-family: var(--font-heading);
  font-size: var(--text-heading-size);
  color: var(--color-textPrimary);
}

.update-prompt__copy {
  font-size: var(--text-body-size);
  color: var(--color-textSecondary);
  line-height: 1.45;
}

.update-prompt__major {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-label-size);
  color: var(--color-warning);
  font-weight: var(--font-weight-medium);
}

.update-prompt__hint {
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
}

.update-prompt__error {
  font-size: var(--text-label-size);
  color: var(--color-danger, #c0392b);
  background: var(--color-dangerLight, rgba(192, 57, 43, 0.08));
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-xs);
}

.update-prompt__actions {
  width: 100%;
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding-top: var(--space-1);
}

.update-prompt__spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary);
  animation: update-prompt-spin 0.8s linear infinite;
}

@keyframes update-prompt-spin {
  to { transform: rotate(360deg); }
}

.update-prompt-enter-active,
.update-prompt-leave-active {
  transition: opacity var(--duration-base);
}

.update-prompt-enter-active .update-prompt__dialog,
.update-prompt-leave-active .update-prompt__dialog {
  transition: transform var(--duration-base);
}

.update-prompt-enter-from,
.update-prompt-leave-to {
  opacity: 0;
}

.update-prompt-enter-from .update-prompt__dialog,
.update-prompt-leave-to .update-prompt__dialog {
  transform: scale(0.94);
}

@media (max-width: 560px) {
  .update-prompt {
    padding: var(--space-4);
  }

  .update-prompt__dialog {
    padding: var(--space-5);
  }

  .update-prompt__actions {
    flex-direction: column-reverse;
  }

  .update-prompt__actions :deep(.ui-btn) {
    width: 100%;
  }
}
</style>

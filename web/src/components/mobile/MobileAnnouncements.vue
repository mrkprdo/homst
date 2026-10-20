<script setup lang="ts">
import { PhX } from "@phosphor-icons/vue"
import AnnouncementComposer from "@/components/shared/AnnouncementComposer.vue"
import AnnouncementLiveList from "@/components/shared/AnnouncementLiveList.vue"

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="mobile-announcements" @click.self="emit('close')">
    <div
      class="ma-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Announcements"
      @click.stop
    >
      <div class="ma-handle" aria-hidden="true" />
      <div class="ma-header">
        <div>
          <h2>Announcements</h2>
          <p class="ma-subtitle">Send a message to every screen</p>
        </div>
        <button class="ma-close" type="button" aria-label="Close announcements" @click="emit('close')">
          <PhX :size="20" />
        </button>
      </div>

      <div class="ma-body">
        <AnnouncementComposer />
        <AnnouncementLiveList class="ma-live" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.mobile-announcements {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(30, 24, 32, 0.3);
  animation: ma-backdrop-in var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

:global(.dark) .mobile-announcements {
  background: rgba(0, 0, 0, 0.55);
}

.ma-sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 92vh;
  max-height: 92dvh;
  background: var(--color-bgElevated);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  box-shadow: 0 -10px 40px -16px rgba(0, 0, 0, 0.35);
  animation: ma-sheet-in var(--duration-slow) cubic-bezier(0.2, 0.7, 0.3, 1) both;
}

@keyframes ma-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes ma-sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.ma-handle {
  width: 40px;
  height: 4px;
  margin: var(--space-2) auto var(--space-1);
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--color-borderStrong);
}

.ma-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 0 var(--space-4) var(--space-2);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.ma-header h2 {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
}

.ma-subtitle {
  margin-top: 2px;
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
}

.ma-close {
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

.ma-close:focus-visible {
  outline: 2px solid var(--color-accent-darker);
  outline-offset: 2px;
}

.ma-body {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-4) var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
}

.ma-body :deep(.ui-btn) {
  min-height: 48px;
}

.ma-live {
  margin-top: var(--space-4);
}
</style>

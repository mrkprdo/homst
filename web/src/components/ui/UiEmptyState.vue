<script setup lang="ts">
defineProps<{
  message?: string
}>()
</script>

<template>
  <div class="ui-empty">
    <span class="ui-empty__icon"><slot name="icon" /></span>
    <p class="ui-empty__message">{{ message }}</p>
    <slot />
  </div>
</template>

<style scoped>
.ui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-10) var(--space-6);
  color: var(--color-textMuted);
}

.ui-empty__icon {
  font-size: var(--text-display-size);
  opacity: 0.3;
  display: flex;
  align-items: center;
}

.ui-empty__message {
  font-size: var(--text-body-size);
  text-align: center;
}
</style>

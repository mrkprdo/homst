<script setup lang="ts">
defineProps<{
  label?: string
  grow?: boolean
}>()
</script>

<template>
  <label class="ui-field" :class="{ 'ui-field--grow': grow }">
    <span v-if="label" class="ui-field__label">{{ label }}</span>
    <slot />
  </label>
</template>

<style scoped>
.ui-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.ui-field--grow {
  flex: 1;
}

.ui-field__label {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textMuted);
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
</style>

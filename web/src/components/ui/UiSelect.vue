<script setup lang="ts">
defineProps<{
  modelValue?: string
  disabled?: boolean
}>()

defineEmits<{ "update:modelValue": [value: string] }>()
</script>

<template>
  <select
    class="ui-select"
    :value="modelValue"
    :disabled="disabled"
    @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <slot />
  </select>
</template>

<style scoped>
.ui-select {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  padding-right: 36px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background: var(--color-bgSubtle);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23a4adb1' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-thin);
  appearance: none;
  cursor: pointer;
  box-shadow: inset 0 2px 6px var(--shadow-inner), inset 0 -1px 3px var(--shadow-shine);
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}

.ui-select:hover:not(:disabled) {
  border-color: var(--color-borderStrong);
}

.ui-select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: inset 0 2px 6px var(--shadow-inner), 0 0 0 3px var(--color-primaryLight);
}

.ui-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

<script setup lang="ts">
defineProps<{
  modelValue?: string
  type?: "text" | "date" | "time" | "datetime-local" | "email" | "password" | "number" | "tel"
  placeholder?: string
  autofocus?: boolean
  disabled?: boolean
  min?: string | number
  max?: string | number
  step?: string | number
}>()

defineEmits<{ "update:modelValue": [value: string] }>()
</script>

<template>
  <input
    class="ui-input"
    :type="type ?? 'text'"
    :value="modelValue"
    :placeholder="placeholder"
    :autofocus="autofocus"
    :disabled="disabled"
    :min="min"
    :max="max"
    :step="step"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

<style scoped>
.ui-input {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background: var(--color-bgSubtle);
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-thin);
  box-shadow: inset 0 2px 6px var(--shadow-inner), inset 0 -1px 3px var(--shadow-shine);
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}

.ui-input::placeholder {
  color: var(--color-textMuted);
}

.ui-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: inset 0 2px 6px var(--shadow-inner), 0 0 0 3px var(--color-primaryLight);
}

.ui-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

input[type="date"].ui-input,
input[type="time"].ui-input,
input[type="datetime-local"].ui-input {
  color-scheme: light dark;
}
</style>

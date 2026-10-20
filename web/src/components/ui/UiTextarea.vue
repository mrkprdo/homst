<script setup lang="ts">
defineProps<{
  modelValue?: string
  placeholder?: string
  rows?: number
  disabled?: boolean
}>()

defineEmits<{ "update:modelValue": [value: string] }>()
</script>

<template>
  <textarea
    class="ui-textarea"
    :value="modelValue"
    :placeholder="placeholder"
    :rows="rows ?? 3"
    :disabled="disabled"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>

<style scoped>
.ui-textarea {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background: var(--color-bgSubtle);
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-thin);
  line-height: var(--text-body-line-height);
  resize: vertical;
  min-height: 60px;
  box-shadow: inset 0 2px 6px var(--shadow-inner), inset 0 -1px 3px var(--shadow-shine);
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}

.ui-textarea::placeholder {
  color: var(--color-textMuted);
}

.ui-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: inset 0 2px 6px var(--shadow-inner), 0 0 0 3px var(--color-primaryLight);
}

.ui-textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

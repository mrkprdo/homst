<script setup lang="ts">
defineProps<{
  variant?: "neutral" | "primary" | "warning" | "success" | "danger"
}>()
</script>

<template>
  <span class="ui-badge" :class="`ui-badge--${variant ?? 'neutral'}`">
    <slot />
  </span>
</template>

<style scoped>
.ui-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: var(--text-label-size);
  min-width: 28px;
  text-align: center;
  position: relative;
}

.ui-badge--neutral {
  background: var(--color-bgSubtle);
  color: var(--color-textMuted);
}

.ui-badge--primary {
  background: var(--color-primary);
  color: var(--color-textInverse);
}

.ui-badge--warning {
  background: var(--color-warning);
  color: var(--color-textInverse);
}

.ui-badge--success {
  background: var(--color-success);
  color: var(--color-textInverse);
}

.ui-badge--danger {
  background: var(--color-danger);
  color: var(--color-textInverse);
}
</style>

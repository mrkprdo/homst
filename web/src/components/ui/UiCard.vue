<script setup lang="ts">
defineProps<{
  padding?: boolean
  accent?: boolean
}>()
</script>

<template>
  <div
    class="ui-card"
    :class="{
      'ui-card--padded': padding !== false,
      'ui-card--accent': accent,
    }"
  >
    <slot />
  </div>
</template>

<style scoped>
.ui-card {
  background: var(--color-bgSurface);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  overflow: hidden;
}

.ui-card--padded {
  padding: var(--space-3) var(--space-6);
}

.ui-card--accent {
  box-shadow:
    0 4px 0 0 var(--shadow-accent-lip),
    0 14px 40px -6px var(--shadow-accent-drop),
    inset 0 3px 8px var(--shadow-shine),
    inset 0 -3px 8px var(--shadow-accent-inner);
  border-color: transparent;
}
</style>

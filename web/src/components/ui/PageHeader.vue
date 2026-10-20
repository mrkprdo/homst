<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <div class="page-header">
    <h2 class="page-header__title">{{ title }}</h2>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-4);
  flex-shrink: 0;
}

.page-header__title {
  font-size: var(--text-title-size);
  font-weight: var(--font-weight-regular);
}

.page-header__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
</style>

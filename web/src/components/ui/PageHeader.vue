<script setup lang="ts">
import NowPlayingBar from "@/components/shared/NowPlayingBar.vue"

defineProps<{
  title: string
}>()
</script>

<template>
  <div class="page-header">
    <h2 class="page-header__title">{{ title }}</h2>
    <div class="page-header__now-playing">
      <NowPlayingBar />
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
  padding-bottom: var(--space-4);
  flex-shrink: 0;
}

.page-header__title {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--text-title-size);
  font-weight: var(--font-weight-regular);
}

.page-header__now-playing {
  justify-self: center;
  min-width: 0;
}

.page-header__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  justify-self: end;
}
</style>

<script setup lang="ts">
defineProps<{
  height?: string
  index?: number
}>()
</script>

<template>
  <div
    class="ui-skeleton"
    :style="{
      height: height ?? '72px',
      '--sk': index ?? 0,
    }"
  />
</template>

<style scoped>
.ui-skeleton {
  border-radius: var(--radius-md);
  background: var(--color-bgElevated);
  box-shadow: 0 3px 0 0 var(--shadow-lip), 0 8px 24px -4px var(--shadow-drop);
  position: relative;
  overflow: hidden;
  animation: card-appear var(--duration-base) ease both;
  animation-delay: calc(var(--sk, 0) * 60ms);
}

.ui-skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--shadow-shine) 45%,
    var(--shadow-shine) 55%,
    transparent 100%
  );
  background-size: 250% 100%;
  animation: shimmer 1.8s ease-in-out infinite;
  animation-delay: calc(var(--sk, 0) * 120ms);
}

@keyframes card-appear {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes shimmer {
  0%   { background-position:  200% 0; }
  100% { background-position: -200% 0; }
}
</style>

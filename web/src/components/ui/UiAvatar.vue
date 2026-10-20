<script setup lang="ts">
defineProps<{
  color?: "peach" | "sage" | "mauve" | "plum" | "sky"
  size?: "sm" | "md" | "lg"
}>()
</script>

<template>
  <div
    class="ui-avatar"
    :class="[`ui-avatar--${size ?? 'md'}`, `ui-avatar--${color ?? 'sage'}`]"
  >
    <slot />
  </div>
</template>

<style scoped>
.ui-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textInverse);
  overflow: hidden;
  flex-shrink: 0;
}

.ui-avatar--sm { width: 28px; height: 28px; }
.ui-avatar--md { width: 36px; height: 36px; }
.ui-avatar--lg { width: 44px; height: 44px; }

.ui-avatar--peach { background: var(--color-peach-base); box-shadow: 0 2px 0 0 var(--color-peach-dark), 0 4px 12px -2px var(--shadow-drop), inset 0 1px 3px var(--shadow-shine), inset 0 -1px 3px var(--shadow-inner); }
.ui-avatar--sage  { background: var(--color-sage-base);  box-shadow: 0 2px 0 0 var(--color-sage-dark),  0 4px 12px -2px var(--shadow-drop), inset 0 1px 3px var(--shadow-shine), inset 0 -1px 3px var(--shadow-inner); }
.ui-avatar--mauve { background: var(--color-mauve-base); box-shadow: 0 2px 0 0 var(--color-mauve-dark), 0 4px 12px -2px var(--shadow-drop), inset 0 1px 3px var(--shadow-shine), inset 0 -1px 3px var(--shadow-inner); }
.ui-avatar--plum  { background: var(--color-plum-base);  box-shadow: 0 2px 0 0 var(--color-plum-dark),  0 4px 12px -2px var(--shadow-drop), inset 0 1px 3px var(--shadow-shine), inset 0 -1px 3px var(--shadow-inner); }
.ui-avatar--sky   { background: var(--color-sky-base);   box-shadow: 0 2px 0 0 var(--color-sky-dark),   0 4px 12px -2px var(--shadow-drop), inset 0 1px 3px var(--shadow-shine), inset 0 -1px 3px var(--shadow-inner); }
</style>

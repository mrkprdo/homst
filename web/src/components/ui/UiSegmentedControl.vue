<script setup lang="ts" generic="T extends string">
import { ref, watch, nextTick, onMounted } from "vue"
import { animate, springs } from "@/lib/motion"
import { useSettings } from "@/composables/useSettings"

const props = defineProps<{
  modelValue: T
  options: { value: T; label: string }[]
}>()

const emit = defineEmits<{ "update:modelValue": [value: T] }>()

const settings = useSettings()
const groupEl = ref<HTMLElement | null>(null)
const indicatorEl = ref<HTMLElement | null>(null)

function positionIndicator(value: T) {
  if (!groupEl.value || !indicatorEl.value) return
  const activeBtn = groupEl.value.querySelector(`[data-value="${value}"]`) as HTMLElement | null
  if (!activeBtn) return

  const btnRect = activeBtn.getBoundingClientRect()
  const groupRect = groupEl.value.getBoundingClientRect()
  indicatorEl.value.style.transform = `translateX(${btnRect.left - groupRect.left}px)`
  indicatorEl.value.style.width = `${btnRect.width}px`
  indicatorEl.value.style.opacity = "1"
}

function animateIndicator(value: T) {
  if (!groupEl.value || !indicatorEl.value) return
  const activeBtn = groupEl.value.querySelector(`[data-value="${value}"]`) as HTMLElement | null
  if (!activeBtn) return

  const btnRect = activeBtn.getBoundingClientRect()
  const groupRect = groupEl.value.getBoundingClientRect()
  const left = btnRect.left - groupRect.left
  const width = btnRect.width

  // Apply width instantly; only translate is animated to avoid layout thrashing
  indicatorEl.value.style.width = `${width}px`
  animate(indicatorEl.value, {
    translateX: [parseFloat(indicatorEl.value.style.transform?.match(/-?\d+/)?.[0] ?? String(left)) ?? left, left],
    ease: springs.toggle,
  })
}

watch(() => props.modelValue, (val) => {
  nextTick(() => animateIndicator(val))
})

// Re-position when font size changes
watch(() => settings.fontSize.value, () => {
  nextTick(() => positionIndicator(props.modelValue))
})

onMounted(() => {
  nextTick(() => positionIndicator(props.modelValue))
})

function select(value: T) {
  emit("update:modelValue", value)
}
</script>

<template>
  <div ref="groupEl" class="segmented-control">
    <div ref="indicatorEl" class="segmented-indicator" />
    <button
      v-for="opt in options"
      :key="opt.value"
      class="segmented-btn"
      :class="{ active: modelValue === opt.value }"
      :data-value="opt.value"
      @click="select(opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented-control {
  position: relative;
  display: inline-flex;
  background: var(--color-bgSubtle);
  border-radius: var(--radius-full);
  padding: 0.15em;
}

.segmented-indicator {
  position: absolute;
  top: 0.15em;
  bottom: 0.15em;
  border-radius: var(--radius-full);
  background: var(--color-bgElevated);
  box-shadow: 0 1px 0 0 var(--shadow-lip), 0 2px 8px -2px var(--shadow-drop);
  opacity: 0;
  will-change: transform, width;
  pointer-events: none;
}

.segmented-btn {
  position: relative;
  z-index: 1;
  padding: 0.3em 1em;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textSecondary);
  font-size: var(--text-body-size);
  font-family: var(--font-family);
  cursor: pointer;
  min-width: unset;
  min-height: unset;
  transition: color var(--duration-fast);
  white-space: nowrap;
}

.segmented-btn.active {
  color: var(--color-textPrimary);
}

.segmented-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>

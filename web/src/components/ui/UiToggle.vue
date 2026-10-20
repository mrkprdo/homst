<script setup lang="ts">
import { ref, watch } from "vue"
import { animate, springs } from "@/lib/motion"

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>()

const toggleEl = ref<HTMLElement | null>(null)
const knobEl = ref<HTMLElement | null>(null)

function animateKnob(on: boolean) {
  if (!knobEl.value) return
  animate(knobEl.value, {
    translateX: on ? "26px" : "0px",
    ease: springs.toggle,
  })
}

// Animate knob on modelValue change
watch(() => props.modelValue, (val) => animateKnob(val))

function onClick() {
  emit("update:modelValue", !props.modelValue)
}
</script>

<template>
  <button ref="toggleEl" class="ui-toggle" :class="{ on: modelValue }" role="switch" :aria-checked="modelValue"
    type="button" @click="onClick">
    <span ref="knobEl" class="ui-toggle__knob" :style="{
      transform: `translateX(${modelValue ? '26px' : '0px'})`,
      transformOrigin: modelValue ? 'right center' : 'left center',
    }" />
  </button>
</template>

<style scoped>
.ui-toggle {
  position: relative;
  width: 54px;
  height: 30px;
  min-width: unset;
  min-height: unset;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  box-shadow: inset 0 2px 6px var(--shadow-inner), inset 0 -1px 3px var(--shadow-shine);
  cursor: pointer;
  transition: background var(--duration-base) cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.ui-toggle.on {
  background: var(--color-primary);
}

.ui-toggle__knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-full);
  background: var(--color-bgElevated);
  box-shadow: 0 1px 0 0 var(--shadow-lip), 0 2px 6px var(--shadow-drop);
  transform: translateX(0px);
  will-change: transform;
}

.ui-toggle:active .ui-toggle__knob {
  scale: 1.25 0.82;
  transition: scale 60ms ease-out;
}

.ui-toggle.on:active .ui-toggle__knob {
  scale: 1.25 0.82;
  transition: scale 60ms ease-out;
}

.ui-toggle:not(:active) .ui-toggle__knob {
  transition: scale 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ui-toggle:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>

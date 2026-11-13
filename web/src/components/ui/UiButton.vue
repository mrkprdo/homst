<script setup lang="ts">
import { ref } from "vue"
import { animate, springs } from "@/lib/motion"

const props = defineProps<{
  variant?: "primary" | "secondary" | "ghost" | "destructive" | "link"
  size?: "sm" | "md"
  disabled?: boolean
  type?: "button" | "submit" | "reset"
}>()

const btnEl = ref<HTMLElement | null>(null)

// A press is a real press, not any pointer that happens to leave the button.
// The old pointerleave release made the button pop every time a mouse passed
// over it, which read as a broken hover state.
let pressed = false

function press() {
  if (props.disabled || !btnEl.value || pressed) return
  pressed = true
  animate(btnEl.value, {
    scaleX: 1.06,
    scaleY: 0.84,
    translateY: "3px",
    duration: 60,
    ease: "outQuart",
  })
}

function release() {
  if (!pressed || !btnEl.value) return
  pressed = false
  animate(btnEl.value, {
    scaleX: [1.06, 1.02, 1],
    scaleY: [0.84, 1.02, 1],
    translateY: ["3px", "-1px", "0px"],
    ease: springs.pop,
  })
}

function onPointerDown(e: PointerEvent) {
  // Ignore right/middle-click on mouse; pen and touch always have button 0.
  if (e.pointerType === "mouse" && e.button !== 0) return
  // Capture keeps pointerup on this button even if the pointer slides off,
  // so a drag release cannot leave the button stuck in its pressed shape.
  if (typeof e.pointerId === "number") {
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
  }
  press()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.repeat) return
  if (e.key === " " || e.key === "Enter") press()
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === " " || e.key === "Enter") release()
}
</script>

<template>
  <button
    ref="btnEl"
    class="ui-btn"
    :class="[
      `ui-btn--${variant ?? 'primary'}`,
      `ui-btn--${size ?? 'md'}`,
      { 'compact-control': (size ?? 'md') === 'sm' },
    ]"
    :disabled="disabled"
    :type="type ?? 'button'"
    @pointerdown="onPointerDown"
    @pointerup="release"
    @pointercancel="release"
    @pointerleave="release"
    @keydown="onKeyDown"
    @keyup="onKeyUp"
    @click="release"
    @blur="release"
  >
    <span class="ui-btn__inner"><slot /></span>
  </button>
</template>

<style scoped>
.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full);
  cursor: pointer;
  position: relative;
  transform-origin: center bottom;
  transition:
    background var(--duration-fast),
    box-shadow var(--duration-fast),
    color var(--duration-fast);
}

.ui-btn__inner {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-family);
  font-weight: var(--font-weight-regular);
  pointer-events: none;
}

/* ── Sizes ── */
.ui-btn--md {
  min-width: 48px;
  min-height: 48px;
  padding: 0 var(--space-5);
}

.ui-btn--md .ui-btn__inner { font-size: var(--text-body-size); }

.ui-btn--sm {
  min-width: unset;
  min-height: unset;
  padding: var(--space-2) var(--space-4);
}

.ui-btn--sm .ui-btn__inner { font-size: var(--text-label-size); }

/* Compact pills keep their 30px visual height, but the hit area grows to a
   fingertip. Horizontal expansion is small so side-by-side actions in a
   settings row do not steal each other's taps. */
.ui-btn--sm::after {
  content: "";
  position: absolute;
  inset: -8px -2px;
  border-radius: var(--radius-full);
}

/* ── Variants ── */
.ui-btn--primary {
  background: linear-gradient(165deg, var(--color-accent-light, #c5c8af), var(--color-accent-base, #b1b695) 55%, var(--color-accent-dark, #8e9277));
  color: var(--color-textInverse);
  box-shadow:
    0 2px 0 0 var(--color-accent-dark, #8e9277),
    0 4px 12px -2px var(--shadow-drop),
    inset 0 1px 3px var(--shadow-shine),
    inset 0 -1px 3px var(--shadow-inner);
}

.ui-btn--primary:hover {
  background: linear-gradient(165deg, var(--color-accent-lighter, #d8dac9), var(--color-accent-light, #c5c8af) 55%, var(--color-accent-base, #b1b695));
}

.ui-btn--secondary {
  background: linear-gradient(165deg, var(--color-mauve-lighter), var(--color-mauve-base) 55%, var(--color-mauve-dark));
  color: var(--color-textInverse);
  box-shadow:
    0 2px 0 0 var(--color-mauve-dark),
    0 4px 12px -2px var(--shadow-drop),
    inset 0 1px 3px var(--shadow-shine),
    inset 0 -1px 3px var(--shadow-inner);
}

.ui-btn--secondary:hover {
  background: linear-gradient(165deg, var(--color-mauve-lightest), var(--color-mauve-light) 55%, var(--color-mauve-base));
}

.ui-btn--destructive {
  background: linear-gradient(165deg, var(--color-plum-lighter), var(--color-plum-base) 55%, var(--color-plum-dark));
  color: var(--color-textInverse);
  box-shadow:
    0 2px 0 0 var(--color-plum-dark),
    0 4px 12px -2px var(--shadow-drop),
    inset 0 1px 3px var(--shadow-shine),
    inset 0 -1px 3px var(--shadow-inner);
}

.ui-btn--ghost {
  background: transparent;
  color: var(--color-textPrimary);
  border: 1px solid var(--color-border);
  box-shadow: none;
}

.ui-btn--ghost:hover { background: var(--color-bgSubtle); }

.ui-btn--link {
  background: none;
  border: none;
  color: var(--color-textMuted);
  padding: 0;
  min-width: unset;
  min-height: unset;
  border-radius: 0;
  box-shadow: none;
}

/* The visible link is small by design; the hit area is not. Fitts's law and
   the 44px touch-target rule both fail on a 20px-tall word, especially on the
   wall display. The pseudo-element keeps the header visually quiet while
   giving the shortcut a full-height target. */
.ui-btn--link::after {
  content: "";
  position: absolute;
  inset: -12px -10px;
  border-radius: var(--radius-xs);
}

.ui-btn--link:hover { color: var(--color-primary); }

/* ── States ── */
.ui-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.ui-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

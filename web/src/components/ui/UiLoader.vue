<script setup lang="ts">
withDefaults(defineProps<{
  size?: "sm" | "md" | "lg"
}>(), {
  size: "md",
})
</script>

<template>
  <span class="ui-loader" :class="`ui-loader--${size}`" aria-hidden="true">
    <span
      v-for="index in 9"
      :key="index"
      class="ui-loader__dot"
      :style="{ '--i': `${9 - index}` }"
    />
  </span>
</template>

<style scoped>
/* Nine static accent beads with a gradient highlight inside each one. A
   brightness wave travels around the ring, so the shade shifts from bead to
   bead without the circles themselves moving. Only opacity is animated, which
   stays cheap while the camera stream is decoding. Callers provide the
   accessible status text; the mark itself is decorative. */
.ui-loader {
  --ui-loader-size: 36px;
  position: relative;
  display: inline-block;
  flex: 0 0 auto;
  width: var(--ui-loader-size);
  height: var(--ui-loader-size);
  color: var(--color-primaryDark, var(--color-primary));
}

.ui-loader--sm {
  --ui-loader-size: 22px;
}

.ui-loader--lg {
  --ui-loader-size: 48px;
}

.ui-loader__dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: calc(var(--ui-loader-size) * 0.23);
  height: calc(var(--ui-loader-size) * 0.23);
  margin-top: calc(var(--ui-loader-size) * -0.115);
  margin-left: calc(var(--ui-loader-size) * -0.115);
  border-radius: 50%;
  /* Accent shade rotates with each bead, so the ring reads as one lit object. */
  background: radial-gradient(
    circle at 32% 26%,
    var(--color-accent-light, #c5c8af),
    var(--color-accent-base, #b1b695) 58%,
    var(--color-accent-dark, #8e9277)
  );
  box-shadow:
    0 1px 2px color-mix(in srgb, var(--color-accent-dark, #8e9277) 45%, transparent),
    inset 0 1px 1px var(--shadow-shine, rgba(255, 255, 255, 0.45));
  transform: rotate(calc(var(--i) * -40deg))
    translateY(calc(var(--ui-loader-size) * -0.34));
  opacity: 0.28;
  animation: ui-loader-bead 1.6s linear infinite;
  animation-delay: calc(var(--i) * -0.1778s);
}

/* Low-power mode shortens every animation to a flicker. A loader still has to
   communicate that work is in progress, and this only changes opacity. */
:global(html.low-power .ui-loader__dot) {
  animation-duration: 1.6s !important;
  animation-iteration-count: infinite !important;
}

/* A bright head fades into a dim tail, then the head jumps to the next bead. */
@keyframes ui-loader-bead {
  0% { opacity: 1; }
  22% { opacity: 0.62; }
  45%, 100% { opacity: 0.28; }
}
</style>

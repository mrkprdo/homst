<script setup lang="ts">
import { computed, onUnmounted, watch, type ComponentPublicInstance } from "vue"
import { useSpotify } from "@/composables/useSpotify"
import { useSettings } from "@/composables/useSettings"
import { syncVinyl } from "@/lib/vinyl"

const { currentTrack } = useSpotify()
const { musicBackground, musicBackgroundSpin } = useSettings()

/**
 * Bind through a ref callback rather than onMounted: the disc mounts later
 * than the component (playback starts, and the node sits behind v-if).
 */
function bindDisc(el: Element | ComponentPublicInstance | null) {
  syncVinyl(el as Element | null)
}

/**
 * A full-bleed record player behind the whole app: the album cover is the
 * record, sized past the viewport diagonal so no corner ever shows while it
 * spins. Only visible while Spotify is actually playing.
 */
const active = computed(
  () => musicBackground.value && !!currentTrack.value?.isPlaying && !!currentTrack.value?.albumArt,
)
const art = computed(() => currentTrack.value?.albumArt ?? "")

// The shells drop their opaque backgrounds while this class is present.
watch(
  active,
  (on) => document.documentElement.classList.toggle("vinyl-backdrop", on),
  { immediate: true },
)

onUnmounted(() => document.documentElement.classList.remove("vinyl-backdrop"))
</script>

<template>
  <Transition name="vinyl-fade">
    <div v-if="active" class="vinyl-backdrop" aria-hidden="true">
      <div :ref="bindDisc" class="vinyl-disc" :class="{ 'vinyl-disc--still': !musicBackgroundSpin }">
        <div class="vinyl-art" :style="{ backgroundImage: `url('${art}')` }" />
        <div class="vinyl-grooves" />
        <div class="vinyl-sheen" />
        <div class="vinyl-spindle" />
      </div>
      <div class="vinyl-veil" />
    </div>
  </Transition>
</template>

<style scoped>
.vinyl-backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background: var(--color-bgBase);
  /* Promote once so the fade and the spin stay on the compositor. */
  transform: translateZ(0);
}

/* 130vmax beats the viewport diagonal on every sane aspect ratio, so the
   circular disc always covers the rectangle behind it. */
.vinyl-disc {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 130vmax;
  height: 130vmax;
  border-radius: 50%;
  overflow: hidden;
  background: #0b0b0d;
  /* Base transform centers the record even if the spin is ever paused. */
  transform: translate(-50%, -50%);
  animation: vinyl-spin var(--vinyl-spin-duration, 20s) linear infinite;
  will-change: transform;
}

/* "Show the cover, but keep it still" — the shared timeline sync skips paused
   animations, so the angle just stays where it was. */
.vinyl-disc--still {
  animation-play-state: paused;
}

.vinyl-art {
  position: absolute;
  inset: 0;
  background-position: center;
  background-size: cover;
  opacity: 0.92;
}

/* Fine concentric grooves so the cover reads as a record, not a wallpaper. */
.vinyl-grooves {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: repeating-radial-gradient(
    circle at center,
    rgba(0, 0, 0, 0.05) 0 2px,
    rgba(255, 255, 255, 0.035) 2px 3px,
    transparent 3px 7px
  );
}

/* Rotating light sweep — the sheen that makes vinyl look shiny. */
.vinyl-sheen {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg at 50% 50%,
    rgba(255, 255, 255, 0) 0deg,
    rgba(255, 255, 255, 0.12) 35deg,
    rgba(255, 255, 255, 0) 95deg,
    rgba(0, 0, 0, 0) 170deg,
    rgba(0, 0, 0, 0.18) 225deg,
    rgba(0, 0, 0, 0) 285deg
  );
}

.vinyl-spindle {
  position: absolute;
  top: 50%;
  left: 50%;
  width: clamp(34px, 4vmin, 64px);
  aspect-ratio: 1;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, #060607 0 42%, #191919 62%, #2a2a2a 100%);
  box-shadow:
    0 0 0 2px rgba(0, 0, 0, 0.45),
    0 2px 14px rgba(0, 0, 0, 0.6),
    inset 0 1px 2px rgba(255, 255, 255, 0.18);
}

/* Theme-colored veil: keeps the image as a background instead of a poster,
   and darkens the edges so the app's surfaces stay legible on top. */
.vinyl-veil {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      circle at 50% 45%,
      color-mix(in srgb, var(--color-bgBase) 20%, transparent) 0%,
      color-mix(in srgb, var(--color-bgBase) 42%, transparent) 58%,
      color-mix(in srgb, var(--color-bgBase) 68%, transparent) 100%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-bgBase) 24%, transparent) 0%,
      transparent 22%,
      transparent 78%,
      color-mix(in srgb, var(--color-bgBase) 34%, transparent) 100%
    );
}

@keyframes vinyl-spin {
  from { transform: translate(-50%, -50%) rotate(0deg); }
  to { transform: translate(-50%, -50%) rotate(360deg); }
}

.vinyl-fade-enter-active,
.vinyl-fade-leave-active {
  transition: opacity 700ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.vinyl-fade-enter-from,
.vinyl-fade-leave-to {
  opacity: 0;
}
</style>

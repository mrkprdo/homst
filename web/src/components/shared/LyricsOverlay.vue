<script setup lang="ts">
import { computed } from "vue"
import { useLyrics } from "@/composables/useLyrics"
import { useSpotify } from "@/composables/useSpotify"

/**
 * Two lines of synced lyrics over the whole dashboard, the line being sung on
 * top. The lyric sheet is one column and the window shows two rows of it, so a
 * new line is a single transform on that column: it glides up while the next
 * line rises into place. No enter/leave cross-fade, which is what made the
 * earlier version blink.
 */
const { lines, activeIndex, startLyrics } = useLyrics()
const { currentTrack } = useSpotify()

startLyrics()

// The whole overlay is tied to real playback, like the vinyl backdrop: pause
// or stop and it fades away instead of leaving a stale line on a kiosk.
const visible = computed(
  () => !!currentTrack.value?.isPlaying && lines.value.length > 0,
)

/** Before the first timestamp (intros) the sheet parks on line one. */
const cursor = computed(() => Math.max(activeIndex.value, 0))

const trackTransform = computed(
  () => `translate3d(0, calc(var(--lyric-row) * ${-cursor.value}), 0)`,
)
</script>

<template>
  <Transition name="lyrics">
    <div v-if="visible" class="lyrics" aria-hidden="true">
      <div class="lyrics-window">
        <div class="lyrics-track" :style="{ transform: trackTransform }">
          <p
            v-for="(line, index) in lines"
            :key="index"
            class="lyric"
            :class="{ 'lyric--now': index === activeIndex }"
          >
            <span class="lyric-text">{{ line.text }}</span>
          </p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.lyrics {
  /* Large enough for a wall display, still narrow enough that most lines stay
     on one row instead of wrapping into a thick block of text. */
  --lyric-size: clamp(32px, 3.4vw, 60px);
  /* One slot fits two wrapped rows, so every scroll step is the same height. */
  --lyric-row: calc(var(--lyric-size) * 2.4);
  --lyric-scrim: color-mix(in srgb, var(--color-bgBase) 52%, transparent);
  --lyric-scrim-strong: color-mix(in srgb, var(--color-bgBase) 74%, transparent);
  position: fixed;
  left: 50%;
  bottom: clamp(18px, 4.5vh, 56px);
  z-index: 50;
  width: 100%;
  transform: translateX(-50%);
  pointer-events: none;
  text-align: center;
  color: var(--color-textPrimary);
}

/* Soft gray wash behind the words so they stay readable over album art:
   transparent, gray, a little darker through the middle, transparent again. */
.lyrics::before {
  content: "";
  position: absolute;
  inset: -1.1em 0;
  z-index: -1;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    var(--lyric-scrim) 22%,
    var(--lyric-scrim-strong) 50%,
    var(--lyric-scrim) 78%,
    transparent 100%
  );
}

.lyrics-window {
  height: calc(var(--lyric-row) * 2);
  overflow: hidden;
  /* Lines dissolve at the edges instead of being cut off. */
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 9%,
    #000 91%,
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 9%,
    #000 91%,
    transparent 100%
  );
}

.lyrics-track {
  transform: translate3d(0, 0, 0);
  transition: transform 620ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.lyric {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--lyric-row);
  padding-inline: 0.35em;
  opacity: 0.4;
  transition: opacity 480ms ease;
}

.lyric--now {
  opacity: 1;
}

.lyric-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  max-width: min(1400px, 88vw);
  font-size: var(--lyric-size);
  font-weight: var(--font-weight-medium, 500);
  line-height: 1.16;
  letter-spacing: -0.012em;
  text-wrap: balance;
  text-shadow:
    0 1px 2px color-mix(in srgb, var(--color-bgBase) 60%, transparent),
    0 0 24px color-mix(in srgb, var(--color-bgBase) 70%, transparent);
}

/* Whole overlay fades in when a synced track starts and out when it stops. */
.lyrics-enter-active,
.lyrics-leave-active {
  transition:
    opacity 620ms ease,
    transform 620ms cubic-bezier(0.22, 1, 0.36, 1);
}

.lyrics-enter-from,
.lyrics-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}

/* A Pi or a reduced-motion reader gets the swap without the travel. */
:global(html.low-power) .lyrics-track {
  transition-duration: 1ms;
}

@media (prefers-reduced-motion: reduce) {
  .lyrics-track {
    transition-duration: 1ms;
  }
}
</style>

<script setup lang="ts">
import { computed } from "vue"
import { useLyrics } from "@/composables/useLyrics"
import { useSpotify } from "@/composables/useSpotify"

/**
 * One anchored lyric line over the dashboard, with the next line as a quiet
 * cue underneath. The sung line keeps the same baseline from line to line: the
 * old words are gone at the switch and the new ones land with a few pixels of
 * rise, so the eye never chases a sheet scrolling upward and two lines are
 * never stacked on top of each other. The cue is half the size and clearly
 * dimmer, which makes "what is being sung" and "what comes next" unmistakable
 * at a glance.
 *
 * Only two lines exist in the DOM at rest (the old sheet rendered the whole
 * song with text shadows) and nothing is masked or scrolled per frame, so this
 * is also much cheaper to paint on the wall display.
 */
const { lines, activeIndex, startLyrics } = useLyrics()
const { currentTrack } = useSpotify()

startLyrics()

// Tied to real playback, like the vinyl backdrop: pause or stop and it fades
// away instead of leaving a lyric on a kiosk.
const visible = computed(
  () => !!currentTrack.value?.isPlaying && lines.value.length > 0,
)

/** Before the first timestamp (intros) the first line waits in a dimmed state. */
const cursor = computed(() => Math.max(activeIndex.value, 0))
const isIntro = computed(() => activeIndex.value < 0)

const current = computed(() => lines.value[cursor.value] ?? null)
const next = computed(() => lines.value[cursor.value + 1] ?? null)

// A fresh key per track + line so a new song or a jump (a seek, or a poll that
// missed a line) replaces the words instead of mutating them in place.
const trackKey = computed(() => currentTrack.value?.id || currentTrack.value?.name || "")
const currentKey = computed(() => `${trackKey.value}:${cursor.value}:${current.value?.timeMs ?? 0}`)
const nextKey = computed(() => `${trackKey.value}:${cursor.value + 1}:${next.value?.timeMs ?? 0}`)
</script>

<template>
  <Transition name="lyrics">
    <div v-if="visible && current" class="lyrics" aria-hidden="true">
      <div class="lyrics-stage">
        <p
          :key="currentKey"
          class="lyric lyric--now"
          :class="{ 'lyric--waiting': isIntro }"
        >
          <span class="lyric-text">{{ current.text }}</span>
        </p>
      </div>

      <div class="lyrics-next">
        <p v-if="next" :key="nextKey" class="lyrics-next__line">
          {{ next.text }}
        </p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.lyrics {
  /* Large enough to read from across the room, capped so most lines stay on
     one row. The cue below is sized from this, not independently. */
  --lyric-size: clamp(32px, 3.4vw, 64px);
  /* A dark gray in light mode, a warm off-white in dark mode: still strong on
     the wash without the weight of full textPrimary. */
  --lyric-ink: color-mix(in srgb, var(--color-textPrimary) 80%, var(--color-bgBase));
  --lyric-scrim: color-mix(in srgb, var(--color-bgBase) 52%, transparent);
  --lyric-scrim-strong: color-mix(in srgb, var(--color-bgBase) 76%, transparent);
  position: fixed;
  left: 50%;
  bottom: clamp(18px, 4.5vh, 56px);
  z-index: 50;
  width: 100%;
  transform: translateX(-50%);
  pointer-events: none;
  text-align: center;
  color: var(--lyric-ink);
}

/* A tall, soft band that blurs the dashboard behind the words and lays a
   gentle wash over it. The mask fades both the blur and the tint out at the
   top and bottom so the band has no hard edge. */
.lyrics::before {
  content: "";
  position: absolute;
  inset: calc(var(--lyric-size) * -1.6) 0 calc(var(--lyric-size) * -0.6);
  z-index: -1;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    var(--lyric-scrim) 26%,
    var(--lyric-scrim-strong) 54%,
    var(--lyric-scrim) 84%,
    transparent 100%
  );
  backdrop-filter: blur(18px) saturate(112%);
  -webkit-backdrop-filter: blur(18px) saturate(112%);
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    #000 20%,
    #000 80%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    #000 20%,
    #000 80%,
    transparent 100%
  );
}

/* Backdrop blur is costly on a Pi; the gradient wash alone keeps the text
   readable there. */
:global(html.low-power) .lyrics::before {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/* No fixed height: the stage is only as tall as the line it holds. Because
   the block is anchored to the bottom, a wrapped line grows upward and its
   last row keeps the same baseline. */
.lyrics-stage {
  position: relative;
  width: 100%;
}

.lyric {
  position: relative;
  width: 100%;
  margin: 0;
  padding-inline: 0.35em;
  opacity: 1;
  /* Re-keyed on every line: the old words leave immediately and the new ones
     land a few pixels high, never two strings on top of each other. */
  animation: lyric-land 240ms cubic-bezier(0.22, 1, 0.36, 1);
  transition: opacity 420ms ease;
}

@keyframes lyric-land {
  from {
    transform: translate3d(0, 0.14em, 0);
  }
}

/* Intro: the first line is present but not yet lit. */
.lyric--waiting {
  opacity: 0.5;
}

.lyric-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  max-width: min(1400px, 88vw);
  margin-inline: auto;
  font-size: var(--lyric-size);
  font-weight: 400;
  line-height: 1.14;
  letter-spacing: -0.012em;
  overflow-wrap: break-word;
  text-wrap: balance;
  text-shadow:
    0 1px 2px color-mix(in srgb, var(--color-bgBase) 62%, transparent),
    0 0 26px color-mix(in srgb, var(--color-bgBase) 76%, transparent);
}

/* Up-next cue: same words as the reading line would be, but clearly a glance
   ahead. One row only — a lyric that long is rare, and truncating a cue is
   less disruptive than letting it wrap and push the current line around. */
.lyrics-next {
  position: relative;
  height: 1.5em;
  margin-top: clamp(8px, 1.1vh, 18px);
  font-size: calc(var(--lyric-size) * 0.5);
}

.lyrics-next__line {
  position: absolute;
  inset: 0;
  margin: 0;
  padding-inline: 0.4em;
  overflow: hidden;
  max-width: min(1400px, 88vw);
  margin-inline: auto;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 400;
  line-height: 1.5;
  letter-spacing: 0;
  color: var(--lyric-ink);
  /* Dimmer than the sung line, still above the 3:1 floor for this size. */
  opacity: 0.62;
  animation: cue-in 240ms ease-out;
  text-shadow:
    0 1px 2px color-mix(in srgb, var(--color-bgBase) 58%, transparent),
    0 0 18px color-mix(in srgb, var(--color-bgBase) 70%, transparent);
}

@keyframes cue-in {
  from {
    opacity: 0;
    transform: translate3d(0, 0.24em, 0);
  }
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
@media (prefers-reduced-motion: reduce) {
  .lyric {
    transition-duration: 1ms;
    animation: none;
  }

  .lyrics-next__line {
    animation: none;
  }
}
</style>

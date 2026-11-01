<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from "vue"
import { PhMusicNote } from "@phosphor-icons/vue"
import { useSpotify } from "@/composables/useSpotify"
import { useSettings } from "@/composables/useSettings"
import { syncVinyl } from "@/lib/vinyl"

/**
 * Compact "now playing" strip for the page toolbars. The app-level Spotify
 * polling already ticks `progressMs` once a second, so this stays in sync
 * without a timer of its own.
 */
const { currentTrack, formatTime } = useSpotify()
const settings = useSettings()

const track = computed(() => currentTrack.value)

// Keep the toolbar record on the same phase as the card and the backdrop.
// A ref callback (not onMounted) because the disc mounts later, once a track
// arrives, and the <Transition> may replace the node.
const discEl = ref<HTMLElement | null>(null)

function bindDisc(el: Element | ComponentPublicInstance | null) {
  discEl.value = (el as HTMLElement | null) ?? null
  syncVinyl(el as Element | null)
}

watch(
  () => [track.value?.id, track.value?.isPlaying],
  () => nextTick(() => syncVinyl(discEl.value)),
)

const progress = computed(() => {
  const t = track.value
  if (!t?.durationMs) return 0
  return Math.min(1, Math.max(0, t.progressMs / t.durationMs))
})

const label = computed(() =>
  track.value ? `${track.value.name} by ${track.value.artists}` : "",
)

/**
 * Scroll the title/artist sideways only when it does not fit. The second copy
 * makes the loop seamless; the speed is held to a readable ~24 px/s and the
 * effect is skipped on low-power / reduced-motion displays.
 */
const textEl = ref<HTMLElement | null>(null)
const copyEl = ref<HTMLElement | null>(null)
const marquee = ref(false)
const marqueeDuration = ref(14)
let resizeObserver: ResizeObserver | null = null

function measureMarquee() {
  const box = textEl.value
  const copy = copyEl.value
  if (!box || !copy) {
    marquee.value = false
    return
  }
  const motionOff =
    document.documentElement.classList.contains("low-power") ||
    (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
  const overflows = copy.offsetWidth > box.clientWidth + 1
  marquee.value = overflows && !motionOff
  if (marquee.value) {
    marqueeDuration.value = Math.min(36, Math.max(12, copy.offsetWidth / 24))
  }
}

function observeMarqueeTargets() {
  resizeObserver?.disconnect()
  if (typeof ResizeObserver === "undefined") return
  resizeObserver ??= new ResizeObserver(() => measureMarquee())
  if (textEl.value) resizeObserver.observe(textEl.value)
  if (copyEl.value) resizeObserver.observe(copyEl.value)
}

watch(
  [textEl, copyEl],
  () => {
    observeMarqueeTargets()
    measureMarquee()
  },
  { flush: "post" },
)

watch(
  () => [track.value?.name, track.value?.artists],
  measureMarquee,
  { flush: "post" },
)

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <Transition name="now-playing">
    <div
      v-if="track"
      class="now-playing"
      :class="{ 'now-playing--paused': !track.isPlaying }"
      role="group"
      :aria-label="`Now playing: ${label}`"
    >
      <div
        :ref="bindDisc"        class="now-playing__disc vinyl-disc"
        :class="{
          'now-playing__disc--paused': !track.isPlaying,
          'now-playing__disc--still': !settings.musicCardSpin.value,
        }"
        aria-hidden="true"
      >
        <img
          v-if="track.albumArt"
          :src="track.albumArt"
          alt=""
          class="now-playing__art"
        />
        <PhMusicNote v-else :size="14" class="now-playing__icon" />
      </div>
      <div class="now-playing__body">
        <div class="now-playing__meta">
          <span
            ref="textEl"
            class="now-playing__text"
            :class="{ 'now-playing__text--marquee': marquee }"
            :title="label"
          >
            <span
              class="now-playing__line"
              :style="marquee ? { '--marquee-duration': `${marqueeDuration}s` } : undefined"
            >
              <span ref="copyEl" class="now-playing__copy">
                <span class="now-playing__title">{{ track.name }}</span>
                <span class="now-playing__artist"> — {{ track.artists }}</span>
              </span>
              <span
                v-if="marquee"
                class="now-playing__copy now-playing__copy--clone"
                aria-hidden="true"
              >
                <span class="now-playing__title">{{ track.name }}</span>
                <span class="now-playing__artist"> — {{ track.artists }}</span>
              </span>
            </span>
          </span>
          <span class="now-playing__time">{{ formatTime(track.progressMs) }}/{{ formatTime(track.durationMs) }}</span>
        </div>
        <div class="now-playing__track" aria-hidden="true">
          <div
            class="now-playing__fill"
            :style="{ transform: `scaleX(${progress})` }"
          />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.now-playing {
  display: flex;
  align-items: center;
  gap: 9px;
  width: clamp(240px, 28vw, 440px);
  min-width: 0;
  padding: 6px 14px 6px 7px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bgElevated);
  box-shadow:
    0 1px 0 0 var(--shadow-lip),
    0 2px 8px -2px var(--shadow-drop);
}

.now-playing--paused {
  opacity: 0.6;
}

/* Album cover spinning like a tiny record, in phase with the card and the
   full-app backdrop (see lib/vinyl.ts). */
.now-playing__disc {
  position: relative;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  overflow: hidden;
  background: radial-gradient(circle at 30% 30%, #3a3a3a, #111 65%, #0a0a0a);
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.35),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  animation: now-playing-spin var(--vinyl-spin-duration, 20s) linear infinite;
}

.now-playing__disc--paused,
.now-playing__disc--still {
  animation-play-state: paused;
}

.now-playing__art {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.now-playing__icon {
  color: var(--color-textMuted);
}

.now-playing__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.now-playing__meta {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.now-playing__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--text-label-size);
  line-height: 1.2;
}

.now-playing__line {
  display: inline;
}

.now-playing__text--marquee .now-playing__line {
  display: flex;
  width: max-content;
  animation: now-playing-marquee var(--marquee-duration, 14s) linear infinite;
  will-change: transform;
}

.now-playing__text--marquee .now-playing__copy {
  padding-right: 2.5em;
}

.now-playing--paused .now-playing__line {
  animation-play-state: paused;
}

.now-playing__title {
  color: var(--color-textPrimary);
  font-weight: var(--font-weight-medium);
}

.now-playing__artist {
  color: var(--color-textMuted);
}

.now-playing__time {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--color-textSecondary);
  font-size: var(--text-micro-size);
  font-variant-numeric: tabular-nums;
}

.now-playing__track {
  height: 3px;
  border-radius: 999px;
  background: var(--color-bgSubtle);
  overflow: hidden;
}

.now-playing__fill {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--color-primary), var(--color-accent-base));
  transform-origin: left center;
  transition: transform 0.3s linear;
}

@keyframes now-playing-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes now-playing-marquee {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(-50%, 0, 0);
  }
}

.now-playing-enter-active,
.now-playing-leave-active {
  transition:
    opacity var(--duration-fast) ease,
    transform var(--duration-fast) ease;
}

.now-playing-enter-from,
.now-playing-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .now-playing__fill {
    transition: none;
  }
}
</style>

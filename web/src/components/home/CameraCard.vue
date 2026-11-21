<script setup lang="ts">
import { computed, ref } from "vue"
import { PhVideoCamera } from "@phosphor-icons/vue"
import UiCard from "@/components/ui/UiCard.vue"
import UiLoader from "@/components/ui/UiLoader.vue"
import { useSettings } from "@/composables/useSettings"
import { useCameraStream } from "@/composables/useCameraStream"
import { BACKDROP_INTERVAL_MS, useVideoBackdrop } from "@/composables/useVideoBackdrop"

/** Big enough to stay sharp in the card without a full 4K canvas copy. */
const STILL_MAX_DIMENSION = 1280

const settings = useSettings()
const streamPath = computed(() => settings.cameraStreamPath.value)
const still = ref<HTMLCanvasElement | null>(null)
const hasStill = ref(false)

/**
 * Copy the last readable frame before the pipeline is torn down. A dropped
 * stream otherwise clears the <video> and leaves the card blank while the
 * automatic reconnect runs; this keeps the last thing the camera saw on screen.
 */
function freezeFrame(el: HTMLVideoElement) {
  const canvas = still.value
  if (!canvas || !el.videoWidth || !el.videoHeight || el.readyState < 2) return

  const scale = Math.min(1, STILL_MAX_DIMENSION / Math.max(el.videoWidth, el.videoHeight))
  const width = Math.max(1, Math.round(el.videoWidth * scale))
  const height = Math.max(1, Math.round(el.videoHeight * scale))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height

  const context = canvas.getContext("2d")
  if (!context) return
  context.drawImage(el, 0, 0, width, height)
  hasStill.value = true
}

const { video, status, error } = useCameraStream(streamPath, { onFreeze: freezeFrame })
const configured = computed(() => !!settings.cameraUrl.value)
const rotation = computed(() => settings.cameraRotation.value)
const backdropActive = computed(
  () => configured.value && status.value !== "idle" && status.value !== "loading",
)
const { canvas: backdrop } = useVideoBackdrop(video, backdropActive, BACKDROP_INTERVAL_MS, rotation)
const reconnecting = computed(() => status.value !== "playing" && status.value !== "idle")
const showStill = computed(
  () => hasStill.value && status.value !== "playing" && status.value !== "idle",
)
const statusText = computed(() => {
  if (status.value === "loading") return "Connecting to camera"
  if (status.value === "retrieving" || status.value === "failed") return "Reconnecting to camera"
  if (status.value === "error") return error.value || "Reconnecting to camera"
  return ""
})
</script>

<template>
  <UiCard
    class="home-block camera-card"
    :class="{ 'camera-card--live': configured }"
    :padding="false"
  >
    <!-- The stream is the card surface: it paints under the header and the
         readout instead of living in a body block below them. -->
    <div v-if="configured" class="camera-scene" aria-hidden="true">
      <canvas ref="backdrop" class="camera-backdrop" />
      <video
        ref="video"
        class="camera-video"
        :class="`camera-video--rotate-${rotation}`"
        autoplay
        muted
        playsinline
      />
      <!-- Shown only while reconnecting, above the (now empty) video element,
           so a dropped stream never turns the card into a blank rectangle. -->
      <canvas
        v-show="showStill"
        ref="still"
        class="camera-still"
        :class="`camera-video--rotate-${rotation}`"
      />
    </div>

    <div class="block-header">
      <span class="block-title">
        <PhVideoCamera :size="18" /><span class="block-title-text">Camera</span>
      </span>
    </div>

    <div v-if="!configured" class="camera-body camera-body--center">
      <div class="camera-setup">
        <PhVideoCamera :size="40" class="camera-setup-icon" />
        <p class="camera-setup-title">Add a camera</p>
        <p class="camera-setup-desc">Paste an RTSP URL in Settings to show the stream here.</p>
      </div>
    </div>

    <div v-else class="camera-body">
      <div
        v-show="reconnecting"
        class="camera-overlay"
        :class="{ 'camera-overlay--frozen': showStill }"
        role="status"
        aria-live="polite"
      >
        <UiLoader size="lg" />
        <span class="camera-status">{{ statusText }}</span>
      </div>
    </div>
  </UiCard>
</template>

<style scoped>
.camera-card {
  position: relative;
  overflow: hidden;
}

/* Full-card video surface, like the weather scene. */
.camera-scene {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  /* Only a live frame should look like a video surface. Empty/loading states
     keep the card background instead of a black rectangle. */
  background: var(--color-bgSubtle);
  /* Lets the rotated video use the whole card's width/height as cq units. */
  container-type: size;
}

/* A live video can be any brightness; dim only the strip behind the header so
   its icon and title stay readable. */
.camera-card--live::after {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: clamp(36px, 26cqh, 88px);
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-bgSurface) 88%, transparent),
    transparent
  );
}

/* Match the shared card chrome from HomeView. Scoped styles on the parent
   only reach this component's root element, so the header needs its own copy. */
.block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex: 0 0 auto;
  min-width: 0;
  padding: var(--space-3) var(--space-4) 0;
  margin-bottom: var(--space-3);
}

.block-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-family: var(--font-display, var(--font-family));
  font-size: var(--text-label-size);
  font-weight: 600;
  letter-spacing: 0.1em;
  line-height: 1.3;
  text-transform: uppercase;
  color: var(--color-textSecondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.block-title svg {
  flex-shrink: 0;
  color: var(--color-textMuted);
}

.block-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The scrim and the header sit above the scene; so does every state overlay. */
.camera-card > .block-header,
.camera-card > .camera-body {
  position: relative;
  z-index: 2;
}

.camera-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.camera-body--center {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bgSubtle);
}

.camera-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(28px) saturate(1.15) brightness(0.55);
  transform: scale(1.12);
  pointer-events: none;
}

/* Low-power clients keep the effect, but useVideoBackdrop only refreshes the
   snapshot every 15 minutes so canvas copies do not compete with video decode. */

.camera-video {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* The frozen frame sits above the video element: after a fatal error the
   pipeline clears the <video> (and its picture) before the next reconnect. */
.camera-still {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.camera-video--rotate-180 {
  transform: rotate(180deg);
}

/* Rotating swaps the displayed axes. Size the video from the container's
   opposite dimension so a 90°/270° turn still fills the tile without
   stretching; `contain` keeps the whole picture visible. */
.camera-video--rotate-90,
.camera-video--rotate-270 {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 100cqh;
  height: 100cqw;
  object-fit: contain;
}

.camera-video--rotate-90 {
  transform: translate(-50%, -50%) rotate(90deg);
}

.camera-video--rotate-270 {
  transform: translate(-50%, -50%) rotate(270deg);
}

.camera-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: var(--space-4);
  pointer-events: none;
}

/* The last frame stays readable behind the loader instead of being hidden. */
.camera-overlay--frozen {
  background: color-mix(in srgb, var(--color-bgBase) 16%, transparent);
}

/* Screen-reader status only: the visible UI is the icon, not a text label. */
.camera-status {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.camera-setup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4);
  text-align: center;
}

.camera-setup-icon {
  color: var(--color-textMuted);
}

.camera-setup-title {
  margin: 0;
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-large);
  color: var(--color-textPrimary);
}

.camera-setup-desc {
  max-width: 32ch;
  margin: 0;
  font-size: var(--text-label-size);
  line-height: 1.35;
  color: var(--color-textMuted);
}
</style>

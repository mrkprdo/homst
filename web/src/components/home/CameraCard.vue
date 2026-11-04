<script setup lang="ts">
import { computed } from "vue"
import { PhVideoCamera, PhWarningCircle } from "@phosphor-icons/vue"
import UiCard from "@/components/ui/UiCard.vue"
import UiButton from "@/components/ui/UiButton.vue"
import { useSettings } from "@/composables/useSettings"
import { useCameraStream } from "@/composables/useCameraStream"
import { useVideoBackdrop } from "@/composables/useVideoBackdrop"

const settings = useSettings()
const streamPath = computed(() => settings.cameraStreamPath.value)
const { video, status, error, retry } = useCameraStream(streamPath)
const configured = computed(() => !!settings.cameraUrl.value)
const rotation = computed(() => settings.cameraRotation.value)
const stalled = computed(() => status.value === "retrieving" || status.value === "failed")
const backdropActive = computed(() => configured.value && (status.value === "playing" || stalled.value))
const { canvas: backdrop } = useVideoBackdrop(video, backdropActive)
</script>

<template>
  <UiCard class="home-block camera-card" :padding="false">
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
      <canvas ref="backdrop" class="camera-backdrop" aria-hidden="true" />
      <video
        ref="video"
        class="camera-video"
        :class="[
          `camera-video--rotate-${rotation}`,
          { 'camera-video--stalled': stalled },
        ]"
        autoplay
        muted
        playsinline
      />
      <div v-if="status === 'loading'" class="camera-overlay">
        <span class="camera-loading">Connecting…</span>
      </div>
      <div v-else-if="status === 'retrieving'" class="camera-overlay">
        <span class="camera-loading">retrieving stream...</span>
      </div>
      <div v-else-if="status === 'failed'" class="camera-overlay camera-overlay--error">
        <PhWarningCircle :size="22" />
        <p class="camera-error">failed retrieving stream</p>
        <UiButton size="sm" @click="retry">Try again</UiButton>
      </div>
      <div v-else-if="status === 'error'" class="camera-overlay camera-overlay--error">
        <PhWarningCircle :size="22" />
        <p class="camera-error">{{ error }}</p>
        <UiButton size="sm" @click="retry">Try again</UiButton>
      </div>
    </div>
  </UiCard>
</template>

<style scoped>
.camera-card {
  overflow: hidden;
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
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.block-title svg {
  flex-shrink: 0;
}

.block-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Compact chrome in short tiles, mirroring the other cards. */
@container w (max-height: 12em) {
  .block-header {
    padding-top: var(--space-2);
    margin-bottom: var(--space-1);
  }

  .block-title {
    gap: var(--space-1);
    font-size: var(--text-label-size);
  }

  .block-title svg {
    width: 14px;
    height: 14px;
  }
}

@container w (max-height: 8em) {
  .block-header {
    padding-top: var(--space-1);
  }
}

@container w (max-width: 9em) {
  .block-header {
    padding-inline: var(--space-2);
  }
}

@container w (max-height: 6em) {
  .camera-card .block-header {
    display: none;
  }
}

.camera-body {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #000;
  overflow: hidden;
  /* Lets the rotated video use the body's own width/height as cq units. */
  container-type: size;
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

/* The live blur is a per-frame canvas copy plus a full-size blur; skip it on
   Raspberry Pi / reduced-motion clients where it competes with video decode. */
:global(html.low-power) .camera-backdrop {
  display: none;
}

.camera-video {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.camera-video--rotate-180 {
  transform: rotate(180deg);
}

/* Keep the last frame visible but clearly signal it is stale. */
.camera-video--stalled {
  filter: blur(10px) brightness(0.65);
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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-4);
  text-align: center;
  background: color-mix(in srgb, #000 62%, transparent);
  color: #fff;
}

.camera-overlay--error {
  background: color-mix(in srgb, #000 78%, transparent);
}

.camera-loading {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
}

.camera-error {
  max-width: 34ch;
  margin: 0;
  font-size: var(--text-label-size);
  line-height: 1.35;
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

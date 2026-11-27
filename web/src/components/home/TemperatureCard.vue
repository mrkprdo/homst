<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue"
import {
  PhDropHalf,
  PhHouse,
  PhThermometer,
  PhWarningCircle,
} from "@phosphor-icons/vue"
import UiCard from "@/components/ui/UiCard.vue"
import { useNest } from "@/composables/useNest"
import { useUi } from "@/composables/useUi"
import type { NestRoom } from "@/api/nest"

const { status, loading, error, refresh, startAutoRefresh, stopAutoRefresh } = useNest()
const ui = useUi()

const rooms = computed(() => status.value?.rooms ?? [])
const roomCount = computed(() => rooms.value.length)
const gridClass = computed(() => `temperature-grid--${Math.min(roomCount.value, 5) || 1}`)

const stats = computed(() => {
  if (!rooms.value.length) return null
  const temperatures = rooms.value.map(room => room.temperatureC)
  const min = Math.min(...temperatures)
  const max = Math.max(...temperatures)
  const sum = temperatures.reduce((total, value) => total + value, 0)
  return {
    average: sum / temperatures.length,
    min,
    max,
    minRoom: rooms.value.find(room => room.temperatureC === min)!,
    maxRoom: rooms.value.find(room => room.temperatureC === max)!,
  }
})

const disconnected = computed(() => !!(status.value?.error || error.value) && rooms.value.length > 0)

function formatTemp(celsius: number) {
  const rounded = Math.round(celsius * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function roomLabel(room: NestRoom) {
  return room.room || room.name
}

function position(celsius: number) {
  if (!stats.value || stats.value.max === stats.value.min) return 50
  const p = ((celsius - stats.value.min) / (stats.value.max - stats.value.min)) * 100
  return Math.min(96, Math.max(4, p))
}

function tint(celsius: number) {
  return `${8 + position(celsius) * 0.12}%`
}

function tileStyle(room: NestRoom) {
  return {
    "--tint": tint(room.temperatureC),
    "--fill": `${Math.max(8, position(room.temperatureC))}%`,
  }
}

function roomTitle(room: NestRoom) {
  return room.room && room.room !== room.name ? `${room.room} · ${room.name}` : room.name
}

const round1 = (value: number) => Math.round(value * 10) / 10

function smoothPath(points: Array<{ x: number; y: number }>) {
  let d = `M${points[0]!.x} ${points[0]!.y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[i + 2] ?? p2
    const c1x = round1(p1.x + (p2.x - p0.x) / 6)
    const c1y = round1(p1.y + (p2.y - p0.y) / 6)
    const c2x = round1(p2.x - (p3.x - p1.x) / 6)
    const c2y = round1(p2.y - (p3.y - p1.y) / 6)
    d += ` C${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`
  }
  return d
}

const sparklines = computed(() => {
  const history = status.value?.history ?? {}
  const paths: Record<string, { line: string; area: string }> = {}
  for (const room of rooms.value) {
    const samples = history[room.id]
    if (!samples || samples.length < 2) continue
    const temps = samples.map(([, temp]) => temp)
    const min = Math.min(...temps)
    const max = Math.max(...temps)
    const mid = (min + max) / 2
    const span = Math.max(max - min, 0.2)
    const points = samples.map(([, temp], index) => ({
      x: round1((index / (samples.length - 1)) * 100),
      y: round1(16 - ((temp - mid) / span) * 12),
    }))
    const line = smoothPath(points)
    paths[room.id] = { line, area: `${line} L100 32 L0 32 Z` }
  }
  return paths
})

function averageDelta(room: NestRoom) {
  if (!stats.value) return ""
  const delta = room.temperatureC - stats.value.average
  if (Math.abs(delta) < 0.05) return "At avg"
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}° vs avg`
}

function openSettings() {
  ui.setPanel("settings")
}

onMounted(() => {
  void refresh()
  startAutoRefresh()
})

onUnmounted(() => {
  stopAutoRefresh()
})
</script>

<template>
  <UiCard class="home-block temperature-card" :padding="false">
    <div class="block-header">
      <span class="block-title">
        <PhThermometer :size="18" /><span class="block-title-text">Temps</span>
      </span>
      <span v-if="stats" class="temperature-average">{{ formatTemp(stats.average) }}°</span>
    </div>

    <div v-if="loading && !status" class="temperature-body temperature-body--center">
      <span class="temperature-muted">Reading temperatures…</span>
    </div>

    <div v-else-if="error && !status" class="temperature-body temperature-body--center">
      <div class="temperature-setup">
        <PhWarningCircle :size="30" class="temperature-setup-icon" />
        <p class="temperature-setup-title">Indoor temperatures unavailable</p>
        <p class="temperature-setup-desc">{{ error }}</p>
      </div>
    </div>

    <div v-else-if="!status?.configured" class="temperature-body temperature-body--center">
      <div class="temperature-setup">
        <PhThermometer :size="34" class="temperature-setup-icon" />
        <p class="temperature-setup-title">Connect Nest</p>
        <p class="temperature-setup-desc">Add your Nest thermostat in Settings to see every room.</p>
        <button type="button" class="temperature-link" @click="openSettings">Open Settings</button>
      </div>
    </div>

    <div v-else-if="status.error && !rooms.length" class="temperature-body temperature-body--center">
      <div class="temperature-setup">
        <PhWarningCircle :size="30" class="temperature-setup-icon" />
        <p class="temperature-setup-title">Nest unavailable</p>
        <p class="temperature-setup-desc">{{ status.error }}</p>
        <button type="button" class="temperature-link" @click="openSettings">Check credentials</button>
      </div>
    </div>

    <div v-else-if="!rooms.length" class="temperature-body temperature-body--center">
      <span class="temperature-muted">{{ error || 'No temperature sensors found.' }}</span>
    </div>

    <div v-else class="temperature-body">
      <p v-if="disconnected" class="temperature-note">{{ status?.error || error }}</p>

      <section v-if="stats" class="temperature-hero" aria-label="Indoor average temperature">
        <div class="hero-value">
          <span class="hero-number">{{ formatTemp(stats.average) }}</span>
          <span class="hero-degree">°</span>
        </div>
        <div class="hero-copy">
          <span class="hero-label">Indoor average</span>
          <div class="hero-range" aria-hidden="true">
            <span
              v-for="room in rooms"
              :key="`dot-${room.id}`"
              class="hero-dot"
              :class="{ 'hero-dot--offline': !room.online }"
              :style="{
                left: `${position(room.temperatureC)}%`,
                opacity: 0.55 + position(room.temperatureC) / 100 * 0.45,
              }"
            />
          </div>
          <div class="hero-extremes">
            <span class="hero-extreme">
              <span class="hero-extreme-name">{{ roomLabel(stats.minRoom) }}</span>
              <span class="hero-extreme-temp">{{ formatTemp(stats.min) }}°</span>
            </span>
            <span class="hero-extreme hero-extreme--right">
              <span class="hero-extreme-name">{{ roomLabel(stats.maxRoom) }}</span>
              <span class="hero-extreme-temp">{{ formatTemp(stats.max) }}°</span>
            </span>
          </div>
        </div>
      </section>

      <div class="temperature-grid" :class="gridClass">
        <article
          v-for="room in rooms"
          :key="room.id"
          class="room-tile"
          :class="{
            'room-tile--offline': !room.online,
            'room-tile--active': room.active,
          }"
          :style="tileStyle(room)"
          :title="roomTitle(room)"
        >
          <svg
            v-if="sparklines[room.id]"
            class="room-spark"
            viewBox="0 0 100 32"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path class="room-spark-area" :d="sparklines[room.id]?.area" />
            <path class="room-spark-line" :d="sparklines[room.id]?.line" />
          </svg>
          <span v-if="room.active" class="room-active-dot" aria-label="Active temperature sensor" />
          <div class="room-head">
            <PhHouse
              v-if="room.kind === 'thermostat'"
              :size="13"
              weight="duotone"
              class="room-icon"
            />
            <PhThermometer v-else :size="13" class="room-icon" />
            <span class="room-name">{{ roomLabel(room) }}</span>
          </div>

          <div class="room-temp-row">
            <span class="room-temp">{{ formatTemp(room.temperatureC) }}°</span>
            <span v-if="room.humidity !== null" class="room-humidity">
              <PhDropHalf :size="11" weight="fill" />{{ room.humidity }}%
            </span>
          </div>

          <div class="room-meta">
            <span v-if="!room.online" class="room-badge room-badge--offline">Offline</span>
            <span v-else-if="room.active" class="room-badge room-badge--active">Active</span>
            <span v-else-if="room.kind === 'thermostat'" class="room-role">Thermostat</span>
            <span v-else class="room-role room-delta">{{ averageDelta(room) }}</span>
          </div>

          <span class="room-meter" aria-hidden="true"><span /></span>
        </article>
      </div>
    </div>
  </UiCard>
</template>

<style scoped>
.temperature-card {
  overflow: hidden;
}

.block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex: 0 0 auto;
  min-width: 0;
  padding: var(--space-3) var(--space-4) 0;
  margin-bottom: var(--space-2);
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
  color: var(--color-accent-base);
}

.block-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.temperature-average {
  display: none;
  flex-shrink: 0;
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textSecondary);
  font-variant-numeric: tabular-nums;
}

.temperature-body {
  flex: 1;
  min-height: 0;
  padding: 0 var(--space-3) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow: hidden;
}

.temperature-body--center {
  display: grid;
  place-items: center;
  text-align: center;
  padding: var(--space-3) var(--space-4);
}

.temperature-muted {
  font-size: var(--text-label-size);
  color: var(--color-textSecondary);
  text-wrap: balance;
}

.temperature-setup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.temperature-setup-icon {
  color: var(--color-primary);
  margin-bottom: var(--space-1);
}

.temperature-setup-title {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.temperature-setup-desc {
  max-width: 32ch;
  font-size: var(--text-label-size);
  line-height: 1.45;
  color: var(--color-textSecondary);
  text-wrap: balance;
}

.temperature-link {
  margin-top: var(--space-1);
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-primary);
  cursor: pointer;
}

.temperature-link:hover {
  text-decoration: underline;
}

.temperature-note {
  flex: 0 0 auto;
  font-size: var(--text-micro-size);
  line-height: 1.35;
  color: var(--color-textSecondary);
}

.temperature-hero {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-1) var(--space-1) 0;
}

.hero-value {
  display: flex;
  align-items: flex-start;
  flex-shrink: 0;
  line-height: 0.9;
  color: var(--color-textPrimary);
}

.hero-number {
  font-size: clamp(1.5rem, 2.6em, 3rem);
  font-weight: var(--font-weight-medium);
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
}

.hero-degree {
  margin-top: 0.08em;
  margin-left: 1px;
  font-size: clamp(0.9rem, 1.3em, 1.5rem);
  color: color-mix(in srgb, var(--color-accent-base) 65%, var(--color-textSecondary));
}

.hero-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.hero-label {
  font-size: var(--text-micro-size);
  line-height: 1.2;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-textSecondary);
}

.hero-range {
  position: relative;
  height: 8px;
  margin: 3px 1px;
  border-radius: var(--radius-full);
  background: linear-gradient(
    90deg,
    var(--color-accent-light) 0%,
    var(--color-accent-base) 55%,
    var(--color-accent-dark) 100%
  );
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.18);
}

.hero-dot {
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--color-accent-base);
  border: 2px solid var(--color-bgSurface);
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent-base) 55%, transparent);
}

.hero-dot--offline {
  opacity: 0.45;
}

.hero-extremes {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
}

.hero-extreme {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}

.hero-extreme--right {
  justify-content: flex-end;
  text-align: right;
}

.hero-extreme-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-micro-size);
  color: var(--color-textSecondary);
}

.hero-extreme-temp {
  flex-shrink: 0;
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
  font-variant-numeric: tabular-nums;
}

.temperature-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  grid-auto-rows: minmax(0, 1fr);
  gap: var(--space-2);
  overflow: hidden;
}

.room-tile {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-accent-base) var(--tint), var(--color-bgSurface));
  overflow: hidden;
}

.room-tile--offline {
  opacity: 0.55;
}

.room-spark {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.room-spark-area {
  fill: color-mix(in srgb, var(--color-accent-base) 7%, transparent);
}

.room-spark-line {
  fill: none;
  stroke: color-mix(in srgb, var(--color-accent-base) 45%, transparent);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.room-tile--active .room-head {
  padding-right: 10px;
}

.room-active-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent-base);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent-base) 28%, transparent);
}

.room-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.room-icon {
  flex-shrink: 0;
  color: color-mix(in srgb, var(--color-accent-base) 55%, var(--color-textSecondary));
}

.room-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.2;
  color: var(--color-textSecondary);
}

.room-temp-row {
  position: relative;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1);
  min-width: 0;
  margin-top: auto;
}

.room-temp {
  font-size: var(--text-title-size);
  font-weight: var(--font-weight-medium);
  line-height: 1;
  letter-spacing: -0.03em;
  color: color-mix(in srgb, var(--color-accent-base) 42%, var(--color-textPrimary));
  font-variant-numeric: tabular-nums;
}

.room-humidity {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
  font-size: var(--text-micro-size);
  color: var(--color-textSecondary);
  font-variant-numeric: tabular-nums;
}

.room-meta {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 1.1em;
  font-size: var(--text-micro-size);
  line-height: 1.1;
}

.room-role {
  color: var(--color-textSecondary);
}

.room-delta {
  color: color-mix(in srgb, var(--color-accent-base) 42%, var(--color-textSecondary));
  font-variant-numeric: tabular-nums;
}

.room-badge {
  padding: 1px 5px;
  border-radius: var(--radius-full);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
}

.room-badge--active {
  color: color-mix(in srgb, var(--color-accent-base) 55%, var(--color-textPrimary));
  background: color-mix(in srgb, var(--color-accent-base) 18%, transparent);
}

.room-badge--offline {
  color: var(--color-textSecondary);
  background: var(--color-bgSubtle);
}

.room-meter {
  position: absolute;
  left: var(--space-3);
  right: var(--space-3);
  bottom: 5px;
  height: 3px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-accent-base) 16%, transparent);
  overflow: hidden;
}

.room-meter span {
  display: block;
  width: var(--fill);
  height: 100%;
  border-radius: inherit;
  background: var(--color-accent-base);
}

@container w (max-width: 24em) and (min-height: 13em) {
  .temperature-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .room-tile {
    padding: 6px 8px;
  }

  .room-temp {
    font-size: var(--text-heading-size);
  }

  .hero-extreme-name {
    display: none;
  }
}

@container w (max-width: 34em) and (min-height: 13em) {
  .temperature-grid--4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container w (max-width: 40em) and (min-height: 13em) {
  .temperature-grid--5 .room-tile:last-child {
    grid-column: span 2;
  }
}

@container w (max-height: 13em) {
  .temperature-average {
    display: block;
  }

  .temperature-body {
    gap: 4px;
    padding: 0 var(--space-2) var(--space-2);
  }

  .temperature-hero {
    display: none;
  }

  .temperature-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
  }

  .temperature-grid--1 {
    grid-template-columns: minmax(0, 1fr);
  }

  .temperature-grid--2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .temperature-grid--4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .temperature-grid--5 .room-tile:last-child {
    grid-column: span 2;
  }

  .room-tile {
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    gap: 1px;
    justify-content: center;
  }

  .room-temp-row {
    margin-top: 0;
  }

  .room-head {
    gap: 3px;
  }

  .room-name {
    font-size: 0.62em;
  }

  .room-temp {
    font-size: var(--text-body-size);
  }

  .room-humidity,
  .room-meta,
  .room-meter {
    display: none;
  }
}

@container w (max-height: 13em) and (max-width: 20em) {
  .room-icon {
    display: none;
  }

  .room-name {
    font-size: 0.6em;
  }
}

@container w (max-height: 13em) and (min-width: 24em) {
  .temperature-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .room-tile {
    gap: 2px;
  }

  .room-name {
    font-size: var(--text-micro-size);
  }

  .room-temp {
    font-size: var(--text-title-size);
  }

  .temperature-grid--1 {
    grid-template-columns: minmax(0, 1fr);
  }

  .temperature-grid--2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .temperature-grid--3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .temperature-grid--4 {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>

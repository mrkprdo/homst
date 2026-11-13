<script setup lang="ts">
import { computed } from "vue"

const props = defineProps<{
  code: number
  isDay?: boolean
}>()

type Condition = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm"

const condition = computed<Condition>(() => {
  const code = props.code
  if (code === 0) return "clear"
  if (code === 1 || code === 2) return "partly"
  if (code === 3) return "cloudy"
  if (code === 45 || code === 48) return "fog"
  if (code >= 51 && code <= 57) return "drizzle"
  if (code >= 61 && code <= 67) return "rain"
  if (code >= 71 && code <= 77) return "snow"
  if (code >= 80 && code <= 82) return "rain"
  if (code >= 85 && code <= 86) return "snow"
  if (code >= 95 && code <= 99) return "storm"
  // Unknown/invalid codes stay calm instead of implying a thunderstorm.
  return "cloudy"
})

const night = computed(() => props.isDay === false)

// Splits that used to collapse into the generic rain/snow icon.
const freezing = computed(() => [56, 57, 66, 67].includes(props.code))
const showers = computed(() => [80, 81, 82, 85, 86].includes(props.code))
const hail = computed(() => [96, 99].includes(props.code))

const DROPS = 14
const FLAKES = 16
const STARS = 18
const GLINTS = 6
const HAIL = 7

// Deterministic scatter: the scene is ambient, so a stable composition on every
// refresh matters more than true randomness.
function spread(n: number, step: number, salt = 0): number {
  return (n * step + salt) % 100
}

function dropStyle(n: number) {
  return {
    left: `${6 + spread(n, 37)}%`,
    top: `${spread(n, 61)}%`,
    opacity: `${0.4 + ((n * 13) % 36) / 100}`,
    animationDelay: `-${((n * 0.47) % 1.4).toFixed(2)}s`,
    animationDuration: `${(0.72 + ((n * 17) % 42) / 100).toFixed(2)}s`,
  }
}

function flakeStyle(n: number) {
  const size = 4 + ((n * 7) % 4)
  return {
    left: `${4 + spread(n, 53)}%`,
    top: `${spread(n, 29)}%`,
    width: `${size}px`,
    height: `${size}px`,
    animationDelay: `-${((n * 1.13) % 7).toFixed(2)}s`,
    animationDuration: `${(5.5 + ((n * 11) % 40) / 10).toFixed(2)}s`,
  }
}

function starStyle(n: number) {
  return {
    left: `${5 + spread(n, 47)}%`,
    top: `${4 + spread(n, 23)}%`,
    animationDelay: `-${((n * 0.81) % 4).toFixed(2)}s`,
    animationDuration: `${(2.8 + ((n * 13) % 26) / 10).toFixed(2)}s`,
  }
}

function glintStyle(n: number) {
  return {
    left: `${8 + spread(n, 41)}%`,
    top: `${12 + spread(n, 59)}%`,
    animationDelay: `-${((n * 1.27) % 5).toFixed(2)}s`,
    animationDuration: `${(3.4 + ((n * 9) % 22) / 10).toFixed(2)}s`,
  }
}

function hailStyle(n: number) {
  return {
    left: `${8 + spread(n, 43)}%`,
    top: `${spread(n, 67)}%`,
    animationDelay: `-${((n * 0.61) % 1.1).toFixed(2)}s`,
    animationDuration: `${(0.86 + ((n * 19) % 34) / 100).toFixed(2)}s`,
  }
}
</script>

<template>
  <div
    class="weather-scene"
    :class="[
      `is-${condition}`,
      {
        'is-night': night,
        'is-freezing': freezing,
        'is-showers': showers,
        'is-hail': hail,
      },
    ]"
    aria-hidden="true"
  >
    <div class="wx-wash" />

    <div class="wx-stars">
      <i v-for="n in STARS" :key="`star-${n}`" :style="starStyle(n)" />
    </div>

    <div class="wx-celestial">
      <div class="wx-glow" />
      <div class="wx-rays" />
      <div class="wx-sun" />
      <div class="wx-moon" />
    </div>

    <div class="wx-clouds">
      <div class="wx-cloud wx-cloud--a" />
      <div class="wx-cloud wx-cloud--b" />
      <div class="wx-cloud wx-cloud--c" />
    </div>

    <div class="wx-fog">
      <span />
      <span />
      <span />
    </div>

    <div class="wx-rain">
      <i v-for="n in DROPS" :key="`drop-${n}`" class="wx-drop" :style="dropStyle(n)" />
    </div>

    <div class="wx-snow">
      <i v-for="n in FLAKES" :key="`flake-${n}`" class="wx-flake" :style="flakeStyle(n)" />
    </div>

    <div class="wx-hail">
      <i v-for="n in HAIL" :key="`hail-${n}`" class="wx-hailstone" :style="hailStyle(n)" />
    </div>

    <div class="wx-ice">
      <i v-for="n in GLINTS" :key="`glint-${n}`" class="wx-glint" :style="glintStyle(n)" />
    </div>

    <div class="wx-flash" />

    <div class="wx-bolt">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
/* A full-card weather window: the condition is the surface, not a badge.
   Everything is bounded to the card, uses transform/opacity only, and falls
   back to a composed still frame when motion is reduced. */
.weather-scene {
  --wx-cloud: color-mix(in srgb, var(--color-info) 44%, var(--color-bgSurface));
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  opacity: 0.92;
}

/* ── Sky wash ─────────────────────────────────────────────────────────────── */
.wx-wash {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-info) 14%, transparent),
    transparent 62%
  );
}

.is-clear .wx-wash {
  background:
    radial-gradient(120% 110% at 88% 4%, color-mix(in srgb, var(--color-warning) 34%, transparent), transparent 56%),
    linear-gradient(180deg, color-mix(in srgb, var(--color-sky-light) 24%, transparent), transparent 68%);
}

.is-partly .wx-wash {
  background:
    radial-gradient(100% 100% at 86% 8%, color-mix(in srgb, var(--color-warning) 24%, transparent), transparent 54%),
    linear-gradient(180deg, color-mix(in srgb, var(--color-sky-light) 20%, transparent), transparent 66%);
}

.is-cloudy .wx-wash,
.is-fog .wx-wash {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-info) 22%, transparent),
    color-mix(in srgb, var(--color-info) 7%, transparent) 68%,
    transparent
  );
}

.is-drizzle .wx-wash,
.is-rain .wx-wash {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-info) 30%, transparent),
    color-mix(in srgb, var(--color-info) 10%, transparent) 66%,
    transparent
  );
}

.is-snow .wx-wash {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-sky-light) 34%, transparent),
    color-mix(in srgb, var(--color-sky-lighter) 10%, transparent) 68%,
    transparent
  );
}

/* Fixed slate keeps storms reading as weather, not as the warm accent wash. */
.is-storm .wx-wash {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, #4c5568 32%, transparent),
    color-mix(in srgb, #4c5568 14%, transparent) 64%,
    transparent
  );
}

.is-storm {
  --wx-cloud: color-mix(in srgb, #525c70 60%, var(--color-bgSurface));
}

.is-freezing .wx-wash {
  background:
    radial-gradient(110% 90% at 50% 108%, color-mix(in srgb, var(--color-info) 22%, transparent), transparent 60%),
    linear-gradient(180deg, color-mix(in srgb, var(--color-sky-light) 30%, transparent), transparent 70%);
}

/* Showers keep a sun (or moon) break behind the cloud deck. */
.is-showers .wx-celestial {
  display: block;
  opacity: 0.62;
}

/* ── Sun / moon ───────────────────────────────────────────────────────────── */
.wx-celestial {
  position: absolute;
  top: -18%;
  right: -8%;
  width: clamp(84px, min(62cqh, 54cqw), 280px);
  aspect-ratio: 1;
  display: none;
}

.is-clear .wx-celestial,
.is-partly .wx-celestial {
  display: block;
}

.wx-sun {
  position: absolute;
  inset: 27%;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 32%, #fff4cf 0%, #ffd166 46%, #f0a83c 100%);
}

.wx-glow {
  position: absolute;
  inset: -26%;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, #ffd166 46%, transparent) 0%,
    color-mix(in srgb, #ffd166 16%, transparent) 44%,
    transparent 70%
  );
  animation: wx-breathe 7s ease-in-out infinite alternate;
}

.wx-rays {
  position: absolute;
  inset: -10%;
  border-radius: 50%;
  background: repeating-conic-gradient(
    from 0deg,
    color-mix(in srgb, #ffd166 34%, transparent) 0deg 2.2deg,
    transparent 2.2deg 15deg
  );
  -webkit-mask-image: radial-gradient(circle, transparent 0 31%, #000 35%, #000 57%, transparent 72%);
  mask-image: radial-gradient(circle, transparent 0 31%, #000 35%, #000 57%, transparent 72%);
  animation: wx-spin 120s linear infinite;
}

.wx-moon {
  display: none;
  position: absolute;
  inset: 27%;
  border-radius: 50%;
  background: radial-gradient(
    circle at 38% 34%,
    color-mix(in srgb, #fff 70%, var(--color-sky-lighter)),
    color-mix(in srgb, var(--color-sky-light) 72%, var(--color-bgSurface))
  );
  -webkit-mask-image: radial-gradient(circle at 68% 38%, transparent 0 48%, #000 49%);
  mask-image: radial-gradient(circle at 68% 38%, transparent 0 48%, #000 49%);
  rotate: -14deg;
}

.is-night .wx-sun,
.is-night .wx-rays {
  display: none;
}

.is-night .wx-moon {
  display: block;
}

/* ── Stars ────────────────────────────────────────────────────────────────── */
.wx-stars {
  position: absolute;
  inset: 0;
  display: none;
}

.is-night.is-clear .wx-stars,
.is-night.is-partly .wx-stars {
  display: block;
}

.wx-stars i {
  position: absolute;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: color-mix(in srgb, #fff 78%, var(--color-sky-light));
  opacity: 0.35;
  animation: wx-twinkle 3.6s ease-in-out infinite alternate;
}

/* ── Clouds ───────────────────────────────────────────────────────────────── */
.wx-clouds {
  position: absolute;
  inset: 0;
  display: none;
}

.is-partly .wx-clouds,
.is-cloudy .wx-clouds,
.is-fog .wx-clouds,
.is-drizzle .wx-clouds,
.is-rain .wx-clouds,
.is-snow .wx-clouds,
.is-storm .wx-clouds {
  display: block;
}

.wx-cloud {
  position: absolute;
  height: auto;
  aspect-ratio: 3.1 / 1;
  border-radius: var(--radius-full);
  background: var(--wx-cloud);
  opacity: 0.5;
}

.wx-cloud::before,
.wx-cloud::after {
  content: "";
  position: absolute;
  border-radius: 50%;
  background: var(--wx-cloud);
}

.wx-cloud::before {
  width: 52%;
  aspect-ratio: 1;
  left: 11%;
  bottom: 34%;
}

.wx-cloud::after {
  width: 42%;
  aspect-ratio: 1;
  right: 13%;
  bottom: 28%;
  opacity: 0.92;
}

.wx-cloud--a {
  top: 13%;
  left: -8%;
  width: clamp(96px, 44cqw, 330px);
  animation: wx-drift-a 38s ease-in-out infinite alternate;
}

.wx-cloud--b {
  top: 34%;
  right: -12%;
  width: clamp(116px, 54cqw, 400px);
  opacity: 0.36;
  animation: wx-drift-b 52s ease-in-out infinite alternate;
}

.wx-cloud--c {
  top: 58%;
  left: 24%;
  width: clamp(72px, 30cqw, 230px);
  opacity: 0.22;
  animation: wx-drift-c 66s ease-in-out infinite alternate;
}

.is-cloudy .wx-cloud--a,
.is-storm .wx-cloud--a {
  opacity: 0.62;
}

.is-cloudy .wx-cloud--b,
.is-storm .wx-cloud--b {
  opacity: 0.48;
}

.is-storm .wx-cloud--c {
  opacity: 0.34;
}

.is-fog .wx-cloud {
  opacity: 0.24;
}

/* ── Fog ──────────────────────────────────────────────────────────────────── */
.wx-fog {
  position: absolute;
  inset: 0;
  display: none;
}

.is-fog .wx-fog {
  display: block;
}

.wx-fog span {
  position: absolute;
  left: -12%;
  width: 124%;
  height: clamp(26px, 26cqh, 96px);
  background: radial-gradient(
    ellipse 50% 50% at 50% 50%,
    color-mix(in srgb, var(--color-info) 16%, transparent) 0%,
    color-mix(in srgb, var(--color-info) 8%, transparent) 42%,
    transparent 72%
  );
  animation: wx-fog-drift 26s ease-in-out infinite alternate;
}

.wx-fog span:nth-child(1) {
  top: 30%;
}

.wx-fog span:nth-child(2) {
  top: 48%;
  animation-duration: 34s;
  animation-delay: -8s;
  opacity: 0.8;
}

.wx-fog span:nth-child(3) {
  top: 66%;
  animation-duration: 44s;
  animation-delay: -17s;
  opacity: 0.6;
}

/* ── Rain ─────────────────────────────────────────────────────────────────── */
.wx-rain {
  position: absolute;
  inset: 0;
  display: none;
}

.is-drizzle .wx-rain,
.is-rain .wx-rain,
.is-storm .wx-rain {
  display: block;
}

.wx-drop {
  position: absolute;
  width: 2px;
  height: clamp(10px, 9cqh, 28px);
  border-radius: var(--radius-full);
  background: linear-gradient(
    180deg,
    transparent,
    color-mix(in srgb, var(--color-info) 82%, transparent)
  );
  animation-name: wx-drop;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

.is-drizzle .wx-drop {
  opacity: 0.34 !important;
  height: clamp(7px, 6cqh, 19px);
}

/* ── Snow ─────────────────────────────────────────────────────────────────── */
.wx-snow {
  position: absolute;
  inset: 0;
  display: none;
}

.is-snow .wx-snow {
  display: block;
}

.wx-flake {
  position: absolute;
  border-radius: 50%;
  background: color-mix(in srgb, #fff 86%, var(--color-sky-lighter));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-info) 26%, transparent);
  opacity: 0.85;
  animation-name: wx-flake;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

/* Freezing drizzle/rain leaves a few ice glints on the surface. */
.wx-ice {
  position: absolute;
  inset: 0;
  display: none;
}

.is-freezing .wx-ice {
  display: block;
}

.wx-glint {
  position: absolute;
  width: clamp(6px, 2.2cqh, 11px);
  aspect-ratio: 1;
  border-radius: 1px;
  background: color-mix(in srgb, #fff 74%, var(--color-sky-light));
  rotate: 45deg;
  opacity: 0.7;
  animation: wx-twinkle 3.8s ease-in-out infinite alternate;
}

.wx-glint::before,
.wx-glint::after {
  content: "";
  position: absolute;
  inset: 38% -55%;
  border-radius: var(--radius-full);
  background: inherit;
}

.wx-glint::after {
  rotate: 90deg;
}

/* Hail rides with the thunderstorm. */
.wx-hail {
  position: absolute;
  inset: 0;
  display: none;
}

.is-hail .wx-hail {
  display: block;
}

.wx-hailstone {
  position: absolute;
  width: clamp(4px, 1.9cqh, 7px);
  aspect-ratio: 1;
  border-radius: 50%;
  background: color-mix(in srgb, #fff 76%, var(--color-sky-lighter));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-info) 30%, transparent);
  opacity: 0.85;
  animation-name: wx-hail;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

@keyframes wx-hail {
  0%   { transform: translate3d(0, -40%, 0); opacity: 0; }
  14%  { opacity: 0.85; }
  100% { transform: translate3d(-1cqh, 108cqh, 0); opacity: 0; }
}

/* ── Storm ────────────────────────────────────────────────────────────────── */
.wx-flash {
  position: absolute;
  inset: 0;
  display: none;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-sky-lightest) 58%, transparent),
    transparent 72%
  );
  opacity: 0;
}

.is-storm .wx-flash {
  display: block;
  animation: wx-flash 8s linear infinite;
}

.wx-bolt {
  position: absolute;
  right: 17%;
  bottom: 16%;
  width: clamp(22px, 16cqh, 56px);
  display: none;
  color: color-mix(in srgb, #fff 34%, var(--color-warning));
}

.is-storm .wx-bolt {
  display: block;
}

.wx-bolt svg {
  display: block;
  width: 100%;
  height: auto;
  opacity: 0;
  animation: wx-bolt 8s steps(1, end) infinite;
}

/* ── Motion ───────────────────────────────────────────────────────────────── */
@keyframes wx-breathe {
  from { opacity: 0.55; transform: scale(0.94); }
  to   { opacity: 0.9;  transform: scale(1.07); }
}

@keyframes wx-spin {
  to { transform: rotate(360deg); }
}

@keyframes wx-twinkle {
  from { opacity: 0.18; transform: scale(0.8); }
  to   { opacity: 0.85; transform: scale(1.15); }
}

@keyframes wx-drift-a {
  from { transform: translate3d(-5%, 0, 0); }
  to   { transform: translate3d(7%, 2%, 0); }
}

@keyframes wx-drift-b {
  from { transform: translate3d(6%, 0, 0); }
  to   { transform: translate3d(-7%, -2%, 0); }
}

@keyframes wx-drift-c {
  from { transform: translate3d(-3%, 1%, 0); }
  to   { transform: translate3d(5%, -1%, 0); }
}

@keyframes wx-fog-drift {
  from { transform: translate3d(-4%, 0, 0); }
  to   { transform: translate3d(4%, 0, 0); }
}

@keyframes wx-drop {
  0%   { transform: translate3d(0, -120%, 0); opacity: 0; }
  12%  { opacity: 0.5; }
  100% { transform: translate3d(-2cqh, 112cqh, 0); opacity: 0; }
}

@keyframes wx-flake {
  0%   { transform: translate3d(0, -12cqh, 0); opacity: 0; }
  12%  { opacity: 0.8; }
  50%  { transform: translate3d(2cqh, 54cqh, 0); }
  100% { transform: translate3d(-2cqh, 118cqh, 0); opacity: 0; }
}

@keyframes wx-flash {
  0%, 72%, 100% { opacity: 0; }
  73%           { opacity: 0.55; }
  74%           { opacity: 0; }
  75%           { opacity: 0.32; }
  76%           { opacity: 0; }
}

@keyframes wx-bolt {
  0%, 72%, 100% { opacity: 0; }
  73%           { opacity: 1; }
  74%           { opacity: 0.15; }
  75%           { opacity: 0.9; }
  76%           { opacity: 0; }
}

/* A still, fully composed frame when motion is reduced or the display is weak.
   Static drops/flakes keep their scattered positions via inline top/left. */
@media (prefers-reduced-motion: reduce) {
  :global(html:not(.motion-on) .weather-scene *),
  :global(html:not(.motion-on) .weather-scene *::before),
  :global(html:not(.motion-on) .weather-scene *::after) {
    animation: none !important;
  }
}

:global(html.low-power .weather-scene *),
:global(html.low-power .weather-scene *::before),
:global(html.low-power .weather-scene *::after) {
  animation: none !important;
}
</style>

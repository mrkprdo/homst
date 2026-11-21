<script setup lang="ts">
import { computed } from "vue"
import { encode } from "uqr"

const props = defineProps<{
  payload: string
  label?: string
}>()

/**
 * Generated locally so the network password never leaves the household: the
 * matrix is encoded once per payload and painted as a single SVG path.
 */
const qr = computed(() => {
  try {
    // Four quiet-zone modules: the spec minimum plus a little breathing room.
    const { size, data } = encode(props.payload, { ecc: "M", border: 4 })
    let path = ""
    for (let y = 0; y < data.length; y++) {
      const row = data[y]!
      let x = 0
      while (x < row.length) {
        if (!row[x]) {
          x++
          continue
        }
        let run = 1
        while (row[x + run]) run++
        path += `M${x} ${y}h${run}v1h-${run}z`
        x += run
      }
    }
    return { size, path, radius: size * 0.08 }
  } catch {
    // A network name past the QR capacity simply renders no code.
    return null
  }
})
</script>

<template>
  <svg
    v-if="qr"
    class="wifi-qr"
    :viewBox="`0 0 ${qr.size} ${qr.size}`"
    role="img"
    :aria-label="label ?? 'Wi-Fi QR code'"
    shape-rendering="crispEdges"
  >
    <rect
      class="wifi-qr__paper"
      :width="qr.size"
      :height="qr.size"
      :rx="qr.radius"
    />
    <path class="wifi-qr__modules" :d="qr.path" />
  </svg>
</template>

<style scoped>
/* The code stays dark-on-light for reliable scanning, but both ends of the
   contrast are pulled from the theme: the accent's darkest step for the
   modules and the theme paper (accent-tinted) for the quiet zone. */
.wifi-qr {
  --qr-paper: color-mix(
    in srgb,
    var(--color-accent-lighter, #ffffff) 14%,
    var(--color-paperBright, #ffffff)
  );
  --qr-ink: color-mix(in srgb, var(--color-accent-darker, #1c2828) 88%, #000000);
  display: block;
  width: 100%;
  height: 100%;
  border-radius: clamp(4px, 8%, 16px);
  background: var(--qr-paper);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--qr-ink) 20%, transparent),
    0 6px 16px -10px color-mix(in srgb, var(--qr-ink) 65%, transparent);
}

.wifi-qr__paper {
  fill: var(--qr-paper);
  /* The quiet-zone card is rounded; keep its corners smooth while the
     modules stay on crispEdges. */
  shape-rendering: geometricPrecision;
}

.wifi-qr__modules {
  fill: var(--qr-ink);
}
</style>

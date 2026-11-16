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
    const { size, data } = encode(props.payload, { ecc: "M", border: 3 })
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
    return { size, path }
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
    <rect :width="qr.size" :height="qr.size" fill="#ffffff" />
    <path :d="qr.path" fill="#111111" />
  </svg>
</template>

<style scoped>
.wifi-qr {
  display: block;
  width: 100%;
  height: 100%;
  background: #ffffff;
}
</style>

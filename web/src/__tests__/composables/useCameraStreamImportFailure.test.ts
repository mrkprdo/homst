import { describe, it, expect, vi } from "vitest"
import { defineComponent, h, nextTick, ref } from "vue"
import { mount } from "@vue/test-utils"

// Simulate the hls.js chunk failing to load (offline boot, stale service
// worker, blocked asset). The composable must report it and allow a retry.
vi.mock("hls.js", () => Promise.reject(new Error("chunk load failed")))

import { useCameraStream } from "@/composables/useCameraStream"

describe("useCameraStream (hls.js chunk failure)", () => {
  it("reports the stream error instead of hanging on loading", async () => {
    let api!: ReturnType<typeof useCameraStream>
    const path = ref<string | null>("/live.m3u8")

    const Comp = defineComponent({
      setup() {
        api = useCameraStream(path)
        return () => h("video", { ref: api.video })
      },
    })
    const wrapper = mount(Comp)

    for (let i = 0; i < 40; i += 1) await Promise.resolve()
    await nextTick()

    expect(api.status.value).toBe("error")
    expect(api.error.value).toBe(
      "The camera stream stopped. Check the URL and credentials in Settings.",
    )

    wrapper.unmount()
  })
})

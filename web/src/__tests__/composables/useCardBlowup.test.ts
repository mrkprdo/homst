import { describe, it, expect, vi, afterEach } from "vitest"
import { defineComponent, h, ref, Teleport, nextTick } from "vue"
import { mount, flushPromises } from "@vue/test-utils"
import { setLowPower } from "@/lib/motion"
import { useCardBlowup } from "@/composables/useCardBlowup"

/** Minimal host for the composable: one card and the overlay stage. */
const Harness = defineComponent({
  setup() {
    const { active, stageEl, closeEl, open, close } = useCardBlowup()
    const cardEl = ref<HTMLElement | null>(null)

    return () =>
      h("div", { class: "source" }, [
        h(
          "div",
          {
            ref: cardEl,
            class: "card",
            onDblclick: () => { void open(cardEl.value!, "Card") },
          },
          "Card",
        ),
        active.value
          ? h(Teleport, { to: "body" }, [
              h("div", { class: "layer" }, [
                h("div", { ref: stageEl, class: "stage" }),
                h("button", { ref: closeEl, class: "close", onClick: close }, "Close"),
              ]),
            ])
          : null,
      ])
  },
})

afterEach(() => {
  setLowPower(true)
  delete (HTMLElement.prototype as { animate?: unknown }).animate
  document.body.innerHTML = ""
})

async function openCard() {
  const wrapper = mount(Harness, { attachTo: document.body })
  await wrapper.find(".card").trigger("dblclick")
  await flushPromises()
  await nextTick()
  return wrapper
}

describe("useCardBlowup motion", () => {
  it("uses the spring when the full motion budget is available", async () => {
    setLowPower(false)
    const wrapper = await openCard()

    expect(document.querySelector(".stage .card")).not.toBeNull()

    ;(document.querySelector(".close") as HTMLElement).click()
    await nextTick()
    wrapper.unmount()
  })

  it("keeps a single compositor transform on low-power displays", async () => {
    setLowPower(true)
    const animateMock = vi.fn((_keyframes: Keyframe[], _options?: KeyframeAnimationOptions) => ({
      finished: Promise.resolve(),
      cancel: vi.fn(),
    }))
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animateMock,
    })

    const wrapper = await openCard()

    expect(document.querySelector(".stage .card")).not.toBeNull()
    expect(animateMock).toHaveBeenCalledTimes(1)
    const [keyframes, options] = animateMock.mock.calls[0]!
    expect(keyframes[0]!.transform).toContain("scale")
    expect(keyframes[1]!.transform).toBe("translate(0px, 0px) scale(1, 1)")
    expect(options!.fill).toBe("both")

    ;(document.querySelector(".close") as HTMLElement).click()
    await flushPromises()
    await nextTick()

    expect(animateMock).toHaveBeenCalledTimes(2)
    expect(document.querySelector(".layer")).toBeNull()
    wrapper.unmount()
  })

  it("jumps to the expanded state when motion is switched off", async () => {
    setLowPower(true)
    // jsdom has no Element.animate, so the composable takes the no-motion path.
    expect(typeof (document.createElement("div") as HTMLElement).animate).toBe("undefined")

    const wrapper = await openCard()
    expect(document.querySelector(".stage .card")).not.toBeNull()

    ;(document.querySelector(".close") as HTMLElement).click()
    await nextTick()
    expect(document.querySelector(".layer")).toBeNull()
    wrapper.unmount()
  })
})

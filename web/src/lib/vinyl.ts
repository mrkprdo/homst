export function syncVinyl(el: Element | null | undefined, attempt = 0): void {
  if (!el || typeof el.getAnimations !== "function") return

  void getComputedStyle(el).animationName

  const animations = el.getAnimations()
  if (!animations.length) {
    if (attempt < 3 && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => syncVinyl(el, attempt + 1))
    }
    return
  }

  for (const animation of animations) {
    if (animation.playState === "paused") continue

    try {
      animation.startTime = 0
    } catch {
    }
  }
}

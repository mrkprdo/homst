/**
 * Keep every spinning record in the app at the same angle.
 *
 * Both the Spotify card and the full-app backdrop run a CSS animation with the
 * same duration (`--vinyl-spin-duration`). CSS starts each animation whenever
 * its element happens to mount, so they drift apart. Pinning the animation to
 * the document timeline origin makes the angle a function of wall-clock time
 * only, so both records show the same rotation at any instant.
 */
export function syncVinyl(el: Element | null | undefined, attempt = 0): void {
  if (!el || typeof el.getAnimations !== "function") return

  // Animations are created during style resolution, which is lazy: right after
  // mount (or a ref callback) the element can still report none.
  void getComputedStyle(el).animationName

  const animations = el.getAnimations()
  if (!animations.length) {
    if (attempt < 3 && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => syncVinyl(el, attempt + 1))
    }
    return
  }

  for (const animation of animations) {
    try {
      // startTime 0 => progress === document.timeline.currentTime, shared by
      // every element, regardless of when it was inserted.
      animation.startTime = 0
    } catch {
      // Animations without a controllable timeline can be left alone.
    }
  }
}

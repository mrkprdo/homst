/*
 * Pre-paint theme bootstrap.
 *
 * The Vue app resolves the household theme only after it has loaded settings,
 * which means a display set to dark (or auto-dark while the OS is light) used
 * to paint the light token background first, then flip. This tiny classic
 * script runs from <head> after the stylesheets and before the module bundle,
 * so the first frame already has the right classes and accent.
 *
 * It is intentionally dependency-free and defensive: a private-mode or
 * disabled localStorage must never break the app shell. Keep it in sync with
 * the keys written by App.vue (cacheThemeFlags / cacheAccent).
 */
;(function () {
  var root = document.documentElement

  function read(key) {
    try {
      return window.localStorage.getItem(key)
    } catch (error) {
      return null
    }
  }

  var dark = read("homst-theme-dark")
  if (dark !== "true" && dark !== "false") {
    dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "true"
      : "false"
  }
  root.classList.toggle("dark", dark === "true")

  var preset = read("homst-theme-preset")
  if (preset === "default") root.classList.remove("futur")
  else if (preset === "futur") root.classList.add("futur")

  if (read("homst-theme-warm") === "true") root.classList.add("warm")

  var accent = read("homst-theme-accent")
  if (accent) {
    try {
      var palette = JSON.parse(accent)
      var names = {
        base: "--color-accent-base",
        light: "--color-accent-light",
        lighter: "--color-accent-lighter",
        dark: "--color-accent-dark",
        darker: "--color-accent-darker",
        onAccent: "--color-on-accent",
        actionHover: "--color-actionHover",
      }
      for (var key in names) {
        if (palette[key]) root.style.setProperty(names[key], palette[key])
      }
      if (palette.lighter) root.style.setProperty("--color-accent-glow", palette.lighter)
    } catch (error) {
      // Ignore a corrupt cache; the app re-applies the palette on mount.
    }
  }

  // Match the browser/PWA window chrome to the first painted background.
  try {
    var bg = window.getComputedStyle(root).getPropertyValue("--color-bgBase").trim()
    var meta = document.querySelector('meta[name="theme-color"]')
    if (bg && meta) meta.setAttribute("content", bg)
  } catch (error) {}
})()

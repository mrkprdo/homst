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
    }
  }

  try {
    var bg = window.getComputedStyle(root).getPropertyValue("--color-bgBase").trim()
    var meta = document.querySelector('meta[name="theme-color"]')
    if (bg && meta) meta.setAttribute("content", bg)
  } catch (error) {}
})()

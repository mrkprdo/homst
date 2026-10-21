// Web export — generates CSS custom properties string
import { palette, space, radius, duration, shadowLip, shadowShine, lightMode, darkMode, warmLightMode, warmDarkMode, font, text } from "./tokens"

function cssVars(prefix: string, obj: Record<string, string | number>): string {
  return Object.entries(obj)
    .map(([k, v]) => `  --${prefix}-${k}: ${v};`)
    .join("\n")
}

function paletteVars(p: typeof palette): string {
  let out = ""
  for (const [name, shades] of Object.entries(p)) {
    for (const [shade, val] of Object.entries(shades)) {
      out += `  --color-${name}-${shade}: ${val};\n`
    }
  }
  return out.trimEnd()
}

export function generateCSS(): string {
  return `/* HOMST Design Tokens — Auto-generated. Do not edit directly. */

:root {
${cssVars("space", Object.fromEntries(Object.entries(space).map(([k, v]) => [k, `${v}px`])))}
${cssVars("radius", Object.fromEntries(Object.entries(radius).map(([k, v]) => [k, `${v}px`])))}
${cssVars("duration", Object.fromEntries(Object.entries(duration).map(([k, v]) => [k, `${v}ms`])))}
  --font-family: ${font.family};
  --font-weight-thin: ${font.weight.thin};
  --font-weight-regular: ${font.weight.regular};
  --font-weight-medium: ${font.weight.medium};
  --font-weight-large: ${font.weight.large};
${Object.entries(text).map(([k, v]) => `  --text-${k}-size: ${v.size};\n  --text-${k}-weight: ${v.weight};\n  --text-${k}-line-height: ${v.lineHeight};${v.letterSpacing ? `\n  --text-${k}-letter-spacing: ${v.letterSpacing};` : ""}`).join("\n")}

${paletteVars(palette)}

  /* Light mode semantic */
${cssVars("color", lightMode)}
  --shadow-shine: ${shadowShine.light};
}

/* ── Dark mode ── */
.dark {
${cssVars("color", { ...darkMode, peach: palette.peach.light, sage: palette.sage.light, mauve: palette.mauve.light, plum: palette.plum.light, sky: palette.sky.light })}
  --shadow-shine: ${shadowShine.dark};
${paletteVars({
  peach:  { base: palette.peach.light, light: palette.peach.lighter, lighter: palette.peach.lightest, lightest: "#ffffff", dark: palette.peach.base, darker: palette.peach.dark, darkest: palette.peach.darker },
  sage:   { base: palette.sage.light, light: palette.sage.lighter, lighter: palette.sage.lightest, lightest: "#ffffff", dark: palette.sage.base, darker: palette.sage.dark, darkest: palette.sage.darker },
  mauve:  { base: palette.mauve.light, light: palette.mauve.lighter, lighter: palette.mauve.lightest, lightest: "#ffffff", dark: palette.mauve.base, darker: palette.mauve.dark, darkest: palette.mauve.darker },
  plum:   { base: palette.plum.light, light: palette.plum.lighter, lighter: palette.plum.lightest, lightest: "#ffffff", dark: palette.plum.base, darker: palette.plum.dark, darkest: palette.plum.darker },
  sky:    { base: palette.sky.light, light: palette.sky.lighter, lighter: palette.sky.lightest, lightest: "#ffffff", dark: palette.sky.base, darker: palette.sky.dark, darkest: palette.sky.darker },
})}
}

/* ── Warm lighting overlay (tints the active base theme) ── */
.warm {
${cssVars("color", warmLightMode)}
}

.dark.warm {
${cssVars("color", warmDarkMode)}
  --shadow-shine: rgba(255,240,214,0.12);
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  :root:not(.motion-on) {
    --duration-fast: 0ms;
    --duration-base: 0ms;
    --duration-slow: 0ms;
    --duration-spring: 0ms;
  }
}

/* ── Low-power / Pi display mode (set by lib/motion.ts) ── */
html.low-power {
  --duration-fast: 0ms;
  --duration-base: 0ms;
  --duration-slow: 0ms;
  --duration-spring: 0ms;
}
`
}

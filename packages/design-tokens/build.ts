// Build script — generates web/public/tokens.css + web/public/shadows.css,
// the files the app actually serves (linked from web/index.html).
import { generateCSS } from "./src/web"
import { shadowLip, palette, space } from "./src/tokens"

// Sole output location — resolved from this file so `bun build.ts` works
// from any cwd. Never edit the generated files by hand.
const OUT_DIR = `${import.meta.dir}/../../web/public`

// ── Generate tokens.css ─────────────────────────────────
const css = generateCSS()
await Bun.write(`${OUT_DIR}/tokens.css`, css)

// ── Generate shadows.css ────────────────────────────────

function alpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

type ColorKey = keyof typeof shadowLip

function clayShadow(
  elevation: "sm" | "md" | "lg" | "pressed" | "inset",
  lip: string,
  drop: string,
  inner: string,
): string {
  switch (elevation) {
    case "sm":
      return `0 2px 0 0 ${lip}, 0 4px 12px -2px ${drop}, inset 0 1px 3px var(--shadow-shine, rgba(255,255,255,0.45)), inset 0 -1px 3px ${inner}`
    case "md":
      return `0 3px 0 0 ${lip}, 0 8px 24px -4px ${drop}, inset 0 2px 6px var(--shadow-shine, rgba(255,255,255,0.50)), inset 0 -2px 5px ${inner}`
    case "lg":
      return `0 4px 0 0 ${lip}, 0 14px 40px -6px ${drop}, inset 0 3px 8px var(--shadow-shine, rgba(255,255,255,0.50)), inset 0 -3px 8px ${inner}`
    case "pressed":
      return `inset 0 3px 8px ${drop}, inset 0 -1px 3px rgba(255,255,255,0.25)`
    case "inset":
      return `inset 0 2px 6px ${drop}, inset 0 -1px 3px rgba(255,255,255,0.20)`
  }
}

const colors: { key: ColorKey; name: string }[] = [
  { key: "peach", name: "peach" },
  { key: "sage", name: "sage" },
  { key: "mauve", name: "mauve" },
  { key: "plum", name: "plum" },
  { key: "sky", name: "sky" },
  { key: "neutral", name: "neutral" },
]

function generateShadows(): string {
  let out = "/* HOMST Clay Shadows — Auto-generated. Do not edit directly. */\n\n"

  for (const { key, name } of colors) {
    const lip = shadowLip[key]
    const drop = alpha(lip, 0.38)
    const inner = alpha(lip, 0.18)

    out += `/* ── ${name} ── */\n`
    out += `.shadow-clay-sm-${name} { box-shadow: ${clayShadow("sm", lip, drop, inner)}; }\n`
    out += `.shadow-clay-md-${name} { box-shadow: ${clayShadow("md", lip, drop, inner)}; }\n`
    out += `.shadow-clay-lg-${name} { box-shadow: ${clayShadow("lg", lip, drop, inner)}; }\n`
    out += `.shadow-clay-pressed-${name} { box-shadow: ${clayShadow("pressed", lip, drop, inner)}; }\n`
    out += `.shadow-clay-inset-${name} { box-shadow: ${clayShadow("inset", lip, drop, inner)}; }\n`
    out += "\n"
  }

  // Base clay surface classes (no color — use with CSS vars)
  out += "/* ── Base clay surfaces ── */\n"
  out += ".clay-surface {\n"
  out += "  background: linear-gradient(165deg,\n"
  out += "    var(--clay-gradient-top, rgba(255,255,255,0.12)),\n"
  out += "    transparent 55%,\n"
  out += "    var(--clay-gradient-bottom, rgba(0,0,0,0.07))\n"
  out += "  );\n"
  out += "}\n\n"

  // Interactive clay base
  out += ".clay-interactive {\n"
  out += "  transition: all var(--duration-base, 200ms) cubic-bezier(0.25, 0.46, 0.45, 0.94);\n"
  out += "}\n"
  out += ".clay-interactive:active {\n"
  out += "  transform: translateY(2px) scale(0.99);\n"
  out += "  transition: all 80ms ease-in;\n"
  out += "}\n\n"

  // Dark mode adjustments
  out += "/* ── Dark mode overrides ── */\n"
  out += ".dark .clay-interactive:active {\n"
  out += "  transform: translateY(2px) scale(0.99);\n"
  out += "}\n"

  return out
}

const shadows = generateShadows()
await Bun.write(`${OUT_DIR}/shadows.css`, shadows)

console.log("✓ web/public/tokens.css")
console.log("✓ web/public/shadows.css")

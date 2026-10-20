// Canonical design tokens — single source of truth for HOMST

export const font = {
  family: "'Figtree', sans-serif",
  weight: {
    thin: 300,
    regular: 400,
    medium: 500,
    large: 800,
  },
} as const

export const text = {
  display: { size: "28px", weight: 300, lineHeight: 1.2, letterSpacing: "+0.02em" },
  title:   { size: "20px", weight: 400, lineHeight: 1.3 },
  heading: { size: "16px", weight: 500, lineHeight: 1.4 },
  body:    { size: "14px", weight: 300, lineHeight: 1.6 },
  label:   { size: "12px", weight: 400, lineHeight: 1.4 },
  micro:   { size: "10px", weight: 400, lineHeight: 1.3 },
} as const

// ── Color Palette ───────────────────────────────────────

export const palette = {
  peach:  { base: "#fcd0a1", light: "#fde0c6", lighter: "#feeedb", lightest: "#fef6ee", dark: "#caa681", darker: "#977c61", darkest: "#4c3e30" },
  sage:   { base: "#b1b695", light: "#c5c8af", lighter: "#d8dac9", lightest: "#f0f1eb", dark: "#8e9277", darker: "#6a6e59", darkest: "#35372d" },
  mauve:  { base: "#a690a4", light: "#c4b7c3", lighter: "#e2dde2", lightest: "#f5f3f5", dark: "#857383", darker: "#645663", darkest: "#322b31" },
  plum:   { base: "#5e4b56", light: "#92818b", lighter: "#c5bcc1", lightest: "#ece7e9", dark: "#4b3c45", darker: "#382d34", darkest: "#1c161a" },
  sky:    { base: "#afd2e9", light: "#c3deef", lighter: "#d7eaf4", lightest: "#f0f6fb", dark: "#8ca8ba", darker: "#697e8c", darkest: "#353f46" },
} as const

export type PaletteColor = keyof typeof palette

// ── Spacing (4px base) ──────────────────────────────────

export const space = {
  1:  4,
  2:  8,
  3:  12,
  4:  16,
  5:  20,
  6:  24,
  8:  32,
  10: 40,
  12: 48,
  16: 64,
} as const

// ── Border Radius ───────────────────────────────────────

export const radius = {
  xs:   8,
  sm:   14,
  md:   20,
  lg:   28,
  xl:   36,
  full: 9999,
} as const

// ── Duration ────────────────────────────────────────────

export const duration = {
  fast:   120,
  base:   200,
  slow:   320,
  spring: 400,
} as const

// ── Clay Shadow Lip Colors ──────────────────────────────

export const shadowLip = {
  peach:  "#caa681",
  sage:   "#8e9277",
  mauve:  "#857383",
  plum:   "#4b3c45",
  sky:    "#8ca8ba",
  neutral:"#8e9288",
} as const

// Top-left inset shine (white highlight, not accent-tinted, dims in dark mode)
export const shadowShine = {
  light: "rgba(255,255,255,0.50)",
  dark:  "rgba(255,255,255,0.10)",
} as const

// ── Semantic Colors (light mode) ────────────────────────

export const lightMode = {
  bgBase:       "#f4f3f8",
  bgSurface:    "#fafafa",
  bgElevated:   "#ffffff",
  bgSubtle:     "#eeedf5",
  textPrimary:  "#1c2828",
  textSecondary:"#5c5a5a",
  textMuted:    "#948f8f",
  textInverse:  "#fafafa",
  border:       "#d8d6e0",
  borderStrong: "#b0adb8",
  primary:      "var(--color-accent-base, #b1b695)",
  primaryLight: "var(--color-accent-light, #c5c8af)",
  primaryDark:  "var(--color-accent-dark, #8e9277)",
  success:      "#8e9277",
  warning:      "#caa681",
  danger:       "#a87781",
  info:         "#8ca8ba",
} as const

// ── Semantic Colors (dark mode) ─────────────────────────

export const darkMode = {
  bgBase:       "#1a1820",
  bgSurface:    "#22202e",
  bgElevated:   "#2a2838",
  bgSubtle:     "#1e1c28",
  textPrimary:  "#f0eef5",
  textSecondary:"#b0adb8",
  textMuted:    "#6e6a76",
  textInverse:  "#1c2828",
  border:       "#3a3550",
  borderStrong: "#746ca0",
  primary:      "var(--color-accent-light, #c5c8af)",
  primaryLight: "var(--color-accent-lighter, #d8dac9)",
  primaryDark:  "var(--color-accent-base, #b1b695)",
  success:      "#8e9277",
  warning:      "#caa681",
  danger:       "#a87781",
  info:         "#8ca8ba",
  peach:        "#fcd0a1",
  sage:         "#b1b695",
  mauve:        "#a690a4",
  plum:         "#5e4b56",
  sky:          "#afd2e9",
} as const

// ── Warm lighting overlay (applied on top of light mode) ─

export const warmLightMode = {
  bgBase:       "#f6ecdd",
  bgSurface:    "#fbf2e3",
  bgElevated:   "#fff9ef",
  bgSubtle:     "#f0e3cf",
  textPrimary:  "#2e2214",
  textSecondary:"#6f5a41",
  textMuted:    "#a98f70",
  textInverse:  "#fdf6ea",
  border:       "#e0cfb4",
  borderStrong: "#bda57f",
} as const

// ── Warm lighting overlay (applied on top of dark mode) ──

export const warmDarkMode = {
  bgBase:       "#201811",
  bgSurface:    "#2b2116",
  bgElevated:   "#372a1c",
  bgSubtle:     "#261c12",
  textPrimary:  "#f6e8d3",
  textSecondary:"#cbb192",
  textMuted:    "#927a5c",
  textInverse:  "#201811",
  border:       "#4d3b26",
  borderStrong: "#94744a",
} as const

// ── All Tokens (exported for build scripts) ─────────────

export const tokens = {
  font,
  text,
  palette,
  space,
  radius,
  duration,
  shadowLip,
  lightMode,
  darkMode,
  warmLightMode,
  warmDarkMode,
} as const

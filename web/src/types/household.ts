import { type AccentColor, accentPalette, defaultAccentColors } from "@/composables/useSettings"
import { uid } from "@/utils/uid"

export type ColorShade = "lighter" | "light" | "base" | "dark" | "darker"
export type MemberColor = `${AccentColor}-${ColorShade}`

export interface MemberEntry {
  id: string
  name: string
  color: MemberColor
}

const shades: ColorShade[] = ["lighter", "light", "base", "dark", "darker"]
const baseColors = defaultAccentColors

export const memberColors: { key: MemberColor; hex: string; base: AccentColor }[] = baseColors.flatMap((c) =>
  shades.map((s) => ({
    key: `${c}-${s}` as MemberColor,
    hex: accentPalette[c][s],
    base: c,
  }))
)

export function memberColorHex(key: MemberColor): string {
  const [c, s] = key.split("-") as [AccentColor, ColorShade]
  return accentPalette[c]?.[s] ?? accentPalette[c]?.base ?? "#b1b695"
}

export function createDefaultMember(): MemberEntry {
  return { id: uid(), name: "", color: `${baseColors[0]!}-base` as MemberColor }
}

export function memberDefaultColor(index: number): MemberColor {
  const idx = index % baseColors.length
  return `${baseColors[idx]!}-base` as MemberColor
}

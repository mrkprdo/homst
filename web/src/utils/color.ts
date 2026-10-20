/**
 * Pick the text colour with the stronger contrast against a hex background.
 * Used for avatars and other user-coloured surfaces where member colours range
 * from pale peach to deep plum.
 */
export function readableTextOn(hex: string): string {
  const value = hex.replace("#", "").trim()
  if (!/^[0-9a-f]{6}$/i.test(value)) return "var(--color-textInverse)"

  const channel = (start: number) => {
    const c = parseInt(value.slice(start, start + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance =
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)

  return luminance > 0.25 ? "var(--color-textPrimary)" : "var(--color-textInverse)"
}

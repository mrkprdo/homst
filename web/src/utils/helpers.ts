/**
 * Derive initials from a name string.
 * e.g. "John Doe" → "JD", "Alice" → "A"
 */
export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join("")
}

/**
 * Hash a string to a numeric value for color assignment.
 */
export function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/**
 * Map a hash value to one of the 5 palette color names.
 */
const paletteColors = ["peach", "sage", "mauve", "plum", "sky"] as const
export type PaletteColor = (typeof paletteColors)[number]

export function hashToColor(str: string): PaletteColor {
  return paletteColors[hashString(str) % paletteColors.length]!
}

/**
 * Format a date for display.
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/**
 * Format a time for display.
 */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })
}

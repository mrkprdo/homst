import type { WidgetDef } from "@/api/household"

export type { WidgetDef }

/** localStorage key used to paint the dashboard before settings load. */
export const HOME_LAYOUT_STORAGE_KEY = "homst-widget-layout"

/** Broadcast when a streamed/server layout arrives. */
export const HOME_LAYOUT_EVENT = "homst:widget-layout-updated"

/**
 * The default arrangement on a 6×6 canvas: calendar, weather, date/time,
 * Spotify and To Do across the top; schedule on the lower left; photos filling
 * the lower right.
 */
export const DEFAULT_LAYOUT: WidgetDef[] = [
  { id: "datetime", col: 3, row: 0, w: 1, h: 2 },
  { id: "weather",  col: 2, row: 0, w: 1, h: 2 },
  { id: "schedule", col: 0, row: 3, w: 2, h: 3 },
  { id: "todos",    col: 5, row: 0, w: 1, h: 2 },
  { id: "calendar", col: 0, row: 0, w: 2, h: 3 },
  { id: "photos",   col: 2, row: 2, w: 4, h: 4 },
  { id: "spotify",  col: 4, row: 0, w: 1, h: 2 },
]

export function writeCachedHomeLayout(layout: WidgetDef[]) {
  try {
    localStorage.setItem(HOME_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // Storage can be unavailable in private/locked-down browsers.
  }
}

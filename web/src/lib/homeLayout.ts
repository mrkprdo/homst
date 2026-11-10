import type { WidgetDef } from "@/api/household"

export type { WidgetDef }

/** localStorage key used to paint the dashboard before settings load. */
export const HOME_LAYOUT_STORAGE_KEY = "homst-widget-layout"

/** Broadcast when a streamed/server layout arrives. */
export const HOME_LAYOUT_EVENT = "homst:widget-layout-updated"

/**
 * The default arrangement on a 6×6 canvas: calendar and schedule on the left,
 * a stacked column of camera/temperature/date/weather, and Spotify, photos and
 * To Do on the right.
 */
export const DEFAULT_LAYOUT: WidgetDef[] = [
  { id: "datetime",     col: 2, row: 3, w: 1, h: 2 },
  { id: "weather",      col: 2, row: 5, w: 1, h: 1 },
  { id: "schedule",     col: 0, row: 3, w: 2, h: 3 },
  { id: "todos",        col: 5, row: 0, w: 1, h: 1 },
  { id: "calendar",     col: 0, row: 0, w: 2, h: 3 },
  { id: "temperatures", col: 2, row: 2, w: 1, h: 1 },
  { id: "photos",       col: 3, row: 1, w: 3, h: 5 },
  { id: "spotify",      col: 3, row: 0, w: 2, h: 1 },
  { id: "camera",       col: 2, row: 0, w: 1, h: 2 },
]

export function writeCachedHomeLayout(layout: WidgetDef[]) {
  try {
    localStorage.setItem(HOME_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // Storage can be unavailable in private/locked-down browsers.
  }
}

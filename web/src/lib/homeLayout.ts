import type { WidgetDef } from "@/api/household"

export type { WidgetDef }

export const HOME_LAYOUT_STORAGE_KEY = "homst-widget-layout"

export const HOME_LAYOUT_EVENT = "homst:widget-layout-updated"

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
  }
}

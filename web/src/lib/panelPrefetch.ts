/**
 * Panel chunks that are not needed for the dashboard's first paint.
 *
 * They are split out of the entry bundle and warmed during idle time, so the
 * home screen boots without Calendar/Tasks/Settings/Announcements while a nav
 * tap still switches instantly.
 */
export const panelLoaders = {
  calendar: () => import("@/components/calendar/CalendarView.vue"),
  tasks: () => import("@/components/kanban/KanbanView.vue"),
  announcements: () => import("@/components/announcements/AnnouncementPanel.vue"),
  settings: () => import("@/components/settings/SettingsPanel.vue"),
}

/** Import every panel chunk. Resolves when they are all available. */
export function prefetchPanels(): Promise<unknown[]> {
  return Promise.all(Object.values(panelLoaders).map((load) => load()))
}

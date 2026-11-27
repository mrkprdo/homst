export const panelLoaders = {
  calendar: () => import("@/components/calendar/CalendarView.vue"),
  tasks: () => import("@/components/kanban/KanbanView.vue"),
  announcements: () => import("@/components/announcements/AnnouncementPanel.vue"),
  settings: () => import("@/components/settings/SettingsPanel.vue"),
}

export function prefetchPanels(): Promise<unknown[]> {
  return Promise.all(Object.values(panelLoaders).map((load) => load()))
}

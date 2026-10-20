import { ref, nextTick } from "vue"

export type PanelView = "home" | "calendar" | "tasks" | "settings"
export type DrawerType = "event-detail" | "task-detail" | "member-detail" | "quick-add" | "confirm" | null

export interface DrawerState {
  type: DrawerType
  id: string | null
  date: string | null
  /** Optional start time (HH:MM) prefill — used by quick-add when opened from a timeline click */
  time: string | null
}

const activePanel = ref<PanelView>("home")
const drawer = ref<DrawerState>({ type: null, id: null, date: null, time: null })
const isDrawerOpen = ref(false)
const closeGuard = ref<(() => boolean) | null>(null)

function setPanel(panel: PanelView) {
  activePanel.value = panel
}

function openDrawer(type: NonNullable<DrawerType>, id?: string, date?: string, time?: string) {
  drawer.value = { type, id: id ?? null, date: date ?? null, time: time ?? null }
  nextTick(() => { isDrawerOpen.value = true })
}

function closeDrawer() {
  if (closeGuard.value && !closeGuard.value()) return
  isDrawerOpen.value = false
  setTimeout(() => {
    drawer.value = { type: null, id: null, date: null, time: null }
    closeGuard.value = null
  }, 320)
}

function registerCloseGuard(fn: () => boolean) {
  closeGuard.value = fn
}

function unregisterCloseGuard() {
  closeGuard.value = null
}

export function useUi() {
  return { activePanel, drawer, isDrawerOpen, setPanel, openDrawer, closeDrawer, registerCloseGuard, unregisterCloseGuard }
}

export function _resetUi() {
  activePanel.value = "home"
  drawer.value = { type: null, id: null, date: null, time: null }
  isDrawerOpen.value = false
  closeGuard.value = null
}

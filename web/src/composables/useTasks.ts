import { ref, computed } from "vue"
import { tasksApi } from "@/api/tasks"

export interface Task {
  id: string
  listId: string
  title: string
  description: string
  assigneeId: string | null
  startAt: string | null
  endAt: string | null
  status: "todo" | "doing" | "done"
  priority: "low" | "medium" | "high"
  position: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskList {
  id: string
  householdId: string
  name: string
  color: string
  position: number
}

const tasks   = ref<Task[]>([])
const lists   = ref<TaskList[]>([])
const loading = ref(false)
const initialized = ref(false)

const todos = computed(() => tasks.value.filter(t => t.status === "todo").sort((a, b) => a.position - b.position))
const doing = computed(() => tasks.value.filter(t => t.status === "doing").sort((a, b) => a.position - b.position))
const done  = computed(() => tasks.value.filter(t => t.status === "done").sort((a, b) => a.position - b.position))
const sortedLists = computed(() => [...lists.value].sort((a, b) => a.position - b.position))

function upsertTask(task: Task) {
  const idx = tasks.value.findIndex(t => t.id === task.id)
  if (idx >= 0) tasks.value[idx] = task
  else tasks.value.push(task)
}

function removeTask(id: string) {
  tasks.value = tasks.value.filter(t => t.id !== id)
}

function upsertList(list: TaskList) {
  const idx = lists.value.findIndex(l => l.id === list.id)
  if (idx >= 0) lists.value[idx] = list
  else lists.value.push(list)
}

function removeList(id: string) {
  lists.value = lists.value.filter(l => l.id !== id)
  tasks.value = tasks.value.filter(t => t.listId !== id)
}

async function ensureLoaded() {
  if (initialized.value) return
  initialized.value = true
  loading.value = true
  const [fetchedLists, fetchedTasks] = await Promise.all([
    tasksApi.getTaskLists().catch(() => []),
    tasksApi.getTasks().catch(() => []),
  ])
  for (const l of fetchedLists) upsertList(l)
  for (const t of fetchedTasks) upsertTask(t)
  loading.value = false
}

async function refresh() {
  initialized.value = false
  await ensureLoaded()
}

export function useTasks() {
  return {
    tasks, lists, loading,
    todos, doing, done, sortedLists,
    upsertTask, removeTask,
    upsertList, removeList,
    ensureLoaded, refresh,
  }
}

export function _resetTasks() {
  tasks.value = []
  lists.value = []
  loading.value = false
  initialized.value = false
}

import { api } from "./client"
import type { TaskList, Task } from "@/composables/useTasks"

interface ApiTaskList {
  id: string; household_id: string; name: string; color: string; position: number
}

interface ApiTask {
  id: string; list_id: string; title: string; description: string
  assignee_id: string | null; start_at: string | null; end_at: string | null
  status: string; priority: string; position: number
  created_by: string | null; created_at: string; updated_at: string
}

function mapTaskList(tl: ApiTaskList): TaskList {
  return {
    id: tl.id, householdId: tl.household_id, name: tl.name,
    color: tl.color as TaskList["color"], position: tl.position,
  }
}

export function mapTask(t: ApiTask): Task {
  return {
    id: t.id, listId: t.list_id, title: t.title, description: t.description,
    assigneeId: t.assignee_id, startAt: t.start_at, endAt: t.end_at,
    status: t.status as Task["status"], priority: t.priority as Task["priority"],
    position: t.position, createdBy: t.created_by ?? "",
    createdAt: t.created_at, updatedAt: t.updated_at,
  }
}

function toTaskPayload(data: Partial<Task>): Record<string, unknown> {
  const p: Record<string, unknown> = {}
  if (data.listId     !== undefined) p.list_id     = data.listId
  if (data.title      !== undefined) p.title       = data.title
  if (data.description!== undefined) p.description = data.description
  if (data.assigneeId !== undefined) p.assignee_id = data.assigneeId
  if (data.startAt    !== undefined) p.start_at    = data.startAt
  if (data.endAt      !== undefined) p.end_at      = data.endAt
  if (data.status     !== undefined) p.status      = data.status
  if (data.priority   !== undefined) p.priority    = data.priority
  if (data.position   !== undefined) p.position    = data.position
  return p
}

export const tasksApi = {
  getTaskLists: () =>
    api.get<ApiTaskList[]>("/task-lists").then(r => (Array.isArray(r) ? r : []).map(mapTaskList)),
  createTaskList: (data: Partial<TaskList>) =>
    api.post<ApiTaskList>("/task-lists", { name: data.name, color: data.color, position: data.position }).then(mapTaskList),
  updateTaskList: (id: string, data: Partial<TaskList>) =>
    api.patch<ApiTaskList>(`/task-lists/${id}`, { name: data.name, color: data.color, position: data.position }).then(mapTaskList),
  deleteTaskList: (id: string) => api.delete(`/task-lists/${id}`),

  getTasks: (listId?: string) => {
    const params = listId ? `?list_id=${listId}` : ""
    return api.get<ApiTask[]>(`/tasks${params}`).then(r => (Array.isArray(r) ? r : []).map(mapTask))
  },
  createTask: (data: Partial<Task>) =>
    api.post<ApiTask>("/tasks", toTaskPayload(data)).then(mapTask),
  updateTask: (id: string, data: Partial<Task>) =>
    api.patch<ApiTask>(`/tasks/${id}`, toTaskPayload(data)).then(mapTask),
  moveTask: (id: string, data: { list_id: string; position: number }) =>
    api.patch<ApiTask>(`/tasks/${id}/move`, data).then(mapTask),
  deleteTask: (id: string) => api.delete(`/tasks/${id}`),
}

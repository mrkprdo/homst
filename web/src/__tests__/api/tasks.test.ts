import { describe, it, expect, beforeEach, vi } from "vitest"
import { tasksApi } from "@/api/tasks"

describe("tasksApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("getTaskLists returns lists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ id: "l1", name: "Chores" }]),
    } as Response)

    const result = await tasksApi.getTaskLists()
    expect(result).toHaveLength(1)
  })

  it("createTaskList posts data", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "l1" }),
    } as Response)

    await tasksApi.createTaskList({ name: "Work" })
    expect(spy).toHaveBeenCalledWith("/api/v1/task-lists", expect.objectContaining({ method: "POST" }))
  })

  it("updateTaskList patches data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "l1", name: "Updated" }),
    } as Response)

    const result = await tasksApi.updateTaskList("l1", { name: "Updated" })
    expect(result.name).toBe("Updated")
  })

  it("deleteTaskList sends delete", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true, status: 204,
      json: () => Promise.resolve({}),
    } as Response)
    await tasksApi.deleteTaskList("l1")
  })

  it("getTasks fetches tasks without filter", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ id: "t1" }]),
    } as Response)

    const result = await tasksApi.getTasks()
    expect(result).toHaveLength(1)
  })

  it("getTasks fetches tasks with listId filter", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await tasksApi.getTasks("list-1")
    const [url] = spy.mock.calls[0] as [string]
    expect(url).toContain("list_id=list-1")
  })

  it("createTask posts data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "t1", title: "New" }),
    } as Response)

    const result = await tasksApi.createTask({ listId: "l1", title: "New" })
    expect(result.title).toBe("New")
  })

  it("moveTask patches with list_id and position", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "t1" }),
    } as Response)

    await tasksApi.moveTask("t1", { list_id: "l2", position: 3 })
    expect(spy).toHaveBeenCalledWith("/api/v1/tasks/t1/move", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ list_id: "l2", position: 3 }),
    }))
  })

  it("deleteTask sends delete", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true, status: 204,
      json: () => Promise.resolve({}),
    } as Response)
    await tasksApi.deleteTask("t1")
  })

  it("created tasks maintain correct position value", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "t1", list_id: "l1", title: "First", position: 0 }),
    } as Response)
    const result = await tasksApi.createTask({ listId: "l1", title: "First" })
    expect(result.position).toBe(0)
  })

  it("moveTask sends concurrent moves correctly", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
    spy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "t1" }),
    } as Response)

    const [r1, r2] = await Promise.all([
      tasksApi.moveTask("t1", { list_id: "l2", position: 0 }),
      tasksApi.moveTask("t2", { list_id: "l2", position: 1 }),
    ])
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

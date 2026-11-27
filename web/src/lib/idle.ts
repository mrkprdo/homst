export function scheduleIdle(
  task: () => void,
  idleTimeoutMs = 3000,
  fallbackMs = 1500,
): () => void {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout: idleTimeoutMs })
    return () => {
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(handle)
    }
  }

  const handle = setTimeout(task, fallbackMs)
  return () => clearTimeout(handle)
}

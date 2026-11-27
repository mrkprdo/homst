/**
 * Run a task when the browser is idle, with a bounded timeout.
 *
 * The callback can import a lazily-loaded chunk. Returns a cancel function so
 * a component that unmounts (or a test environment that tears down) never gets
 * a late callback that starts work after it is gone.
 */
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

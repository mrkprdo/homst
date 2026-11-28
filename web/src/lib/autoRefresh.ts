export const AUTO_REFRESH_STALE_MS = 15 * 60_000

export function isClientStale(lastInteraction: number, now = Date.now()): boolean {
  return now - lastInteraction >= AUTO_REFRESH_STALE_MS
}

export function startAutoRefreshTimer(
  intervalMinutes: number,
  isStale: () => boolean,
  reload: () => void,
): ReturnType<typeof setInterval> {
  const minutes = Number.isFinite(intervalMinutes) ? Math.max(1, Math.round(intervalMinutes)) : 60
  return setInterval(() => {
    if (isStale()) reload()
  }, minutes * 60_000)
}

export function reloadClientPage(target: Pick<Location, "reload"> = window.location): void {
  target.reload()
}

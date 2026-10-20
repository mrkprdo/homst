import { ref, onMounted, onUnmounted } from "vue"

export function useNowIndicator() {
  const now = ref(new Date())
  let tick: ReturnType<typeof setTimeout>
  let interval: ReturnType<typeof setInterval>

  onMounted(() => {
    const msToNext = (60 - new Date().getSeconds()) * 1000 - new Date().getMilliseconds()
    tick = setTimeout(() => {
      now.value = new Date()
      interval = setInterval(() => { now.value = new Date() }, 60_000)
    }, msToNext)
  })

  onUnmounted(() => {
    clearTimeout(tick)
    clearInterval(interval)
  })

  function isSameDay(date: Date): boolean {
    const n = now.value
    return n.getFullYear() === date.getFullYear() &&
           n.getMonth() === date.getMonth() &&
           n.getDate() === date.getDate()
  }

  // Returns fraction 0-1 within the given hour cell if it's now; null otherwise
  function nowFraction(date: Date, hour: number): number | null {
    if (!isSameDay(date)) return null
    if (now.value.getHours() !== hour) return null
    return now.value.getMinutes() / 60
  }

  return { now, isSameDay, nowFraction }
}

import { ref } from "vue"
import { listStoredPushes, type StoredPush } from "@/lib/pushStore"

const items = ref<StoredPush[]>([])
const loading = ref(false)
const loaded = ref(false)
let inFlight: Promise<StoredPush[]> | null = null

async function load(force = false): Promise<StoredPush[]> {
  if (loaded.value && !force) return items.value
  if (inFlight) return inFlight

  loading.value = true
  inFlight = listStoredPushes()
    .then((rows) => {
      items.value = rows
      loaded.value = true
      return rows
    })
    .finally(() => {
      loading.value = false
      inFlight = null
    })

  return inFlight
}

export function useOfflineNotifications() {
  return { items, loading, loaded, load }
}

export function _resetOfflineNotifications() {
  items.value = []
  loading.value = false
  loaded.value = false
  inFlight = null
}

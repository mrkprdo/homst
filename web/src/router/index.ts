import { createRouter, createWebHistory } from "vue-router"
import { readHouseholdComplete, writeHouseholdComplete } from "@/lib/householdCache"

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/onboarding",
      name: "onboarding",
      component: () => import("@/components/onboarding/OnboardingWizard.vue"),
    },
    {
      path: "/",
      name: "home",
      component: () => import("@/components/home/HomeView.vue"),
    },
  ],
})

let isComplete = readHouseholdComplete()
let fetched = false
let inFlight: Promise<boolean> | null = null

export function invalidateSettings() {
  fetched = false
  // Pick up the cached answer again; a failed fetch must not erase it.
  isComplete = readHouseholdComplete()
}

export function markComplete() {
  isComplete = true
  fetched = true
  writeHouseholdComplete(true)
}

/** Fetch the authoritative flag, but never hang on an unreachable host. */
async function fetchSettings(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch("/api/v1/household/settings", {
      credentials: "include",
      signal: controller.signal,
    })
    if (res.ok) {
      const data = await res.json()
      isComplete = data?.isComplete ?? false
      writeHouseholdComplete(isComplete)
    }
    // 401/403 → user not authenticated; allow /onboarding, block /
  } catch {
    // Backend unavailable (away from the LAN). Keep the last known answer so
    // an installed PWA can still open its cached views and notification inbox.
  } finally {
    clearTimeout(timer)
  }
  return isComplete
}

/**
 * A phone that has used HOMST before already knows the household is set up.
 * Let it navigate immediately instead of holding the whole SPA on a blank
 * page while a request to the unreachable LAN host times out. The refresh
 * still runs in the background and corrects a genuinely reset household.
 */
function ensureSettings(): Promise<boolean> {
  if (fetched) return Promise.resolve(isComplete)

  if (isComplete) {
    fetched = true
    void fetchSettings().then((complete) => {
      if (!complete) void router.replace("/onboarding")
    })
    return Promise.resolve(true)
  }

  if (!inFlight) {
    inFlight = fetchSettings().then((complete) => {
      fetched = true
      inFlight = null
      return complete
    })
  }
  return inFlight
}

router.beforeEach(async (to) => {
  const complete = await ensureSettings()
  if (!complete && to.path !== "/onboarding") {
    return "/onboarding"
  }
  if (complete && to.path === "/onboarding") {
    return "/"
  }
})

export default router

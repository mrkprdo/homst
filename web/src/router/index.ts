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
  isComplete = readHouseholdComplete()
}

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
  } catch {
  } finally {
    clearTimeout(timer)
  }
  return isComplete
}

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

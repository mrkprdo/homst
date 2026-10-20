import { createRouter, createWebHistory } from "vue-router"

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

let isComplete = false
let fetched = false

export function invalidateSettings() {
  fetched = false
}

export function markComplete() {
  isComplete = true
  fetched = true
}

async function ensureSettings(): Promise<boolean> {
  if (fetched) return isComplete
  try {
    const res = await fetch("/api/v1/household/settings", { credentials: "include" })
    if (res.ok) {
      const data = await res.json()
      isComplete = data?.isComplete ?? false
    }
    // 401/403 → user not authenticated; allow /onboarding, block /
  } catch { /* backend unavailable */ }
  fetched = true
  return isComplete
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

import { createApp } from "vue"
import router from "./router"
import App from "./App.vue"
import { captureNotificationIntent } from "@/composables/useNotificationIntent"
import "@fontsource/figtree/300.css"
import "@fontsource/figtree/400.css"
import "@fontsource/figtree/500.css"
import "@fontsource/jost/latin-500.css"
import "@fontsource/jost/latin-600.css"
import "@fontsource/jost/latin-700.css"
import "./global.css"

// Capture the push deep link before the router can redirect and drop its query.
captureNotificationIntent()

const app = createApp(App)
app.use(router)
router.isReady().then(() => app.mount("#app"))

if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let refreshing = false
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing || !hadController) return
    refreshing = true
    window.location.reload()
  })
}

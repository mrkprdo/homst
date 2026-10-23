<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { useSettings } from "@/composables/useSettings"
import { calendarApi } from "@/api/calendar"
import { tasksApi } from "@/api/tasks"
import { PhCheck, PhX, PhCalendarBlank } from "@phosphor-icons/vue"
import { REMINDER_OPTIONS, reminderMinutesFromValue } from "@/utils/reminders"

const emit = defineEmits<{ close: [] }>()

const { ensureDefaultCalendar, upsertEvent } = useEvents()
const { lists, tasks: allTasks, upsertTask, upsertList, ensureLoaded: ensureTasksLoaded } = useTasks()
const { members, ensureLoaded: loadMembers } = useMembers()
const { defaultReminderMinutes } = useSettings()

/** Pre-fill value for the "Remind me" select from the household default. */
function defaultReminderValue(): string {
  return defaultReminderMinutes.value != null ? String(defaultReminderMinutes.value) : ""
}

const tab = ref<"event" | "task">("event")

onMounted(async () => {
  await Promise.all([loadMembers(), ensureTasksLoaded()])
})

const eventTitle = ref("")
const eventDate = ref("")
const eventEndDate = ref("")
const eventStartTime = ref("")
const eventEndTime = ref("")
const eventAllDay = ref(false)
const eventAssigneeId = ref("")
const eventRecurrence = ref("none")
const eventReminder = ref(defaultReminderValue())
const eventRecurEnd = ref<"forever" | "date" | "count">("forever")
const eventRecurEndDate = ref("")
const eventRecurCount = ref(10)
const eventDescription = ref("")

const taskTitle = ref("")
const taskPriority = ref<"low" | "medium" | "high">("medium")
const taskDueDate = ref("")
const taskAssigneeId = ref("")
const taskDescription = ref("")

const submitting = ref(false)
const toast = ref(false)

const memberColorMap = computed(() => {
  const map: Record<string, string> = {}
  members.value.forEach(m => { map[m.id] = m.color })
  return map
})

function formatDateForInput(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function formatTimeForInput(date: Date): string {
  return date.toTimeString().slice(0, 5)
}

function addMinutesToTime(time: string, minutes: number): string {
  if (!time) return ""
  const [h, m] = time.split(":").map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return ""
  const total = (h * 60 + m + minutes) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

const todayDate = formatDateForInput(new Date())
const nowTime = formatTimeForInput(new Date())
const laterTime = addMinutesToTime(nowTime, 60)

function buildRecurEnd(): Record<string, string | number> {
  if (eventRecurEnd.value === "date" && eventRecurEndDate.value) {
    return { until: new Date(eventRecurEndDate.value + "T23:59:59").toISOString() }
  }
  if (eventRecurEnd.value === "count") {
    return { count: eventRecurCount.value }
  }
  return {}
}

// ── Smart end time: keep it after start ──
watch(eventStartTime, (val) => {
  if (!val) return
  const end = eventEndTime.value
  if (!end || end <= val) {
    eventEndTime.value = addMinutesToTime(val, 60)
  }
})

// ── End date can never be before start date ──
watch(eventDate, (val) => {
  if (eventEndDate.value && val && eventEndDate.value < val) {
    eventEndDate.value = val
  }
})

const DURATIONS = [
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
]

function applyDuration(minutes: number) {
  eventAllDay.value = false
  const start = eventStartTime.value || nowTime
  eventStartTime.value = start
  eventEndTime.value = addMinutesToTime(start, minutes)
}

const eventTimeError = computed(() => {
  if (eventAllDay.value) return null
  const startDate = eventDate.value || todayDate
  const endDate = eventEndDate.value || startDate
  if (endDate < startDate) return "End date can't be before the start date"
  if (endDate === startDate) {
    const s = eventStartTime.value
    const e = eventEndTime.value
    if (s && e && e <= s) return "End time must be after the start time"
  }
  return null
})

const RECUR_LABELS: Record<string, string> = {
  daily: "daily", weekly: "weekly", biweekly: "every 2 weeks", monthly: "monthly", yearly: "yearly",
}

const eventSummary = computed(() => {
  const startDate = eventDate.value || todayDate
  const endDate = eventEndDate.value || startDate
  const fmtDate = (isoDate: string) =>
    new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
  const fmtTime = (t: string) => {
    if (!t) return ""
    const [h, m] = t.split(":").map(Number)
    const hh = h % 12 || 12
    return `${hh}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`
  }
  let text: string
  const startTime = eventStartTime.value || nowTime
  const endTime = eventEndTime.value || addMinutesToTime(startTime, 60)
  if (eventAllDay.value) {
    text = endDate !== startDate
      ? `${fmtDate(startDate)} – ${fmtDate(endDate)} · All day`
      : `${fmtDate(startDate)} · All day`
  } else if (endDate !== startDate) {
    text = `${fmtDate(startDate)}, ${fmtTime(startTime)} – ${fmtDate(endDate)}, ${fmtTime(endTime)}`
  } else {
    text = `${fmtDate(startDate)} · ${fmtTime(startTime)} – ${fmtTime(endTime)}`
  }
  if (eventRecurrence.value !== "none") {
    text += ` · Repeats ${RECUR_LABELS[eventRecurrence.value] ?? eventRecurrence.value}`
  }
  if (eventReminder.value !== "") {
    text += ` · ${REMINDER_OPTIONS.find(o => o.value === eventReminder.value)?.label ?? "Reminder set"}`
  }
  return text
})

async function createEvent() {
  if (!eventTitle.value.trim() || eventTimeError.value) return
  const calId = await ensureDefaultCalendar()
  const startDateStr = eventDate.value || todayDate
  const endDateStr = eventEndDate.value || startDateStr
  const startTime = eventStartTime.value || nowTime
  const endTime = eventEndTime.value || addMinutesToTime(startTime, 60)
  const startAt = new Date(`${startDateStr}T${startTime}`).toISOString()
  let endAt: string | undefined
  if (eventAllDay.value) {
    endAt = endDateStr !== startDateStr ? new Date(`${endDateStr}T23:59:59`).toISOString() : undefined
  } else {
    let endMs = new Date(`${endDateStr}T${endTime}`).getTime()
    const startMs = new Date(startAt).getTime()
    if (endMs <= startMs) endMs = startMs + 3600000
    endAt = new Date(endMs).toISOString()
  }
  submitting.value = true
  try {
    const saved = await calendarApi.createEvent({
      calendar_id: calId,
      title: eventTitle.value.trim(),
      description: eventDescription.value.trim(),
      start_at: startAt,
      end_at: endAt,
      all_day: eventAllDay.value,
      recurrence: eventRecurrence.value !== "none" ? { freq: eventRecurrence.value, ...buildRecurEnd() } : null,
      reminder_minutes: reminderMinutesFromValue(eventReminder.value),
      assignee_id: eventAssigneeId.value || null,
    })
    upsertEvent(saved)
  } catch {
    // silent
  } finally {
    submitting.value = false
    toast.value = true
    setTimeout(() => { toast.value = false; emit("close") }, 800)
  }
}

async function createTask() {
  if (!taskTitle.value.trim()) return
  submitting.value = true
  try {
    let listId = lists.value[0]?.id
    if (!listId) {
      const created = await tasksApi.createTaskList({ name: "General", color: "#948f8f", position: 0 })
      upsertList(created)
      listId = created.id
    }
    const saved = await tasksApi.createTask({
      listId,
      title: taskTitle.value.trim(),
      description: taskDescription.value.trim(),
      assigneeId: taskAssigneeId.value || null,
      startAt: taskDueDate.value ? new Date(taskDueDate.value + "T00:00:00").toISOString() : null,
      priority: taskPriority.value,
      position: allTasks.value.length,
    })
    upsertTask(saved)
  } catch {
    // silent
  } finally {
    submitting.value = false
    toast.value = true
    setTimeout(() => { toast.value = false; emit("close") }, 800)
  }
}

function handleSubmit() {
  if (tab.value === "event") createEvent()
  else createTask()
}

const canSubmit = computed(() => {
  const t = tab.value === "event" ? eventTitle.value : taskTitle.value
  return t.trim().length > 0 && !submitting.value && (tab.value !== "event" || !eventTimeError.value)
})

const priorities = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const
</script>

<template>
  <div class="mobile-quick-add" @click.self="emit('close')">
    <div class="mqa-sheet" role="dialog" aria-modal="true" aria-label="Add event or task" @click.stop>
      <div class="mqa-handle" />
      <div class="mqa-header">
        <button class="mqa-tab" type="button" :class="{ active: tab === 'event' }" @click="tab = 'event'">Event</button>
        <button class="mqa-tab" type="button" :class="{ active: tab === 'task' }" @click="tab = 'task'">Task</button>
        <button class="mqa-close" type="button" @click="emit('close')" aria-label="Close"><PhX :size="20" /></button>
      </div>

      <div class="mqa-body">
        <!-- Event form -->
        <template v-if="tab === 'event'">
          <div class="mqa-field">
            <label class="mqa-label">Title</label>
            <input v-model="eventTitle" class="mqa-input" placeholder="Event title" autofocus />
          </div>

          <div class="mqa-row">
            <div class="mqa-field mqa-field--grow">
              <label class="mqa-label">Date</label>
              <input v-model="eventDate" type="date" class="mqa-input" :placeholder="todayDate" />
            </div>
            <label class="mqa-toggle-label" :class="{ active: eventAllDay }">
              <input v-model="eventAllDay" type="checkbox" class="mqa-checkbox" />
              <span>All day</span>
            </label>
          </div>

          <div class="mqa-field">
            <label class="mqa-label">End date <span class="mqa-hint">(optional — for multi-day events)</span></label>
            <input v-model="eventEndDate" type="date" class="mqa-input" :min="eventDate || todayDate" placeholder="Same day" />
          </div>

          <div v-if="!eventAllDay" class="mqa-row">
            <div class="mqa-field mqa-field--half">
              <label class="mqa-label">Start</label>
              <input v-model="eventStartTime" type="time" class="mqa-input" :placeholder="nowTime" />
            </div>
            <div class="mqa-field mqa-field--half">
              <label class="mqa-label">End</label>
              <input v-model="eventEndTime" type="time" class="mqa-input" :placeholder="laterTime" />
            </div>
          </div>

          <div v-if="!eventAllDay" class="mqa-duration">
            <span class="mqa-duration-label">Quick duration</span>
            <div class="mqa-duration-chips">
              <button v-for="d in DURATIONS" :key="d.minutes" type="button" class="mqa-duration-chip"
                @click="applyDuration(d.minutes)">{{ d.label }}</button>
            </div>
          </div>

          <p v-if="eventTimeError" class="mqa-error">{{ eventTimeError }}</p>

          <div v-if="eventSummary" class="mqa-summary">
            <PhCalendarBlank :size="14" class="mqa-summary-icon" />
            <span>{{ eventSummary }}</span>
          </div>

          <div v-if="members.length > 0" class="mqa-field">
            <label class="mqa-label">Assigned to</label>
            <div class="mqa-select-wrap">
              <span v-if="eventAssigneeId" class="mqa-select-dot" :style="{ background: memberColorMap[eventAssigneeId] }" />
              <select v-model="eventAssigneeId" class="mqa-select" :class="{ 'has-dot': !!eventAssigneeId }">
                <option value="">No one</option>
                <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name || "Unnamed" }}</option>
              </select>
            </div>
          </div>

          <div class="mqa-field">
            <label class="mqa-label">Repeat</label>
            <select v-model="eventRecurrence" class="mqa-select">
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>

          <div v-if="eventRecurrence !== 'none'" class="mqa-recur-end">
            <div class="mqa-field">
              <label class="mqa-label">End repeat</label>
              <select v-model="eventRecurEnd" class="mqa-select">
                <option value="forever">Forever</option>
                <option value="date">On date</option>
                <option value="count">After</option>
              </select>
            </div>
            <div v-if="eventRecurEnd === 'date'" class="mqa-field">
              <label class="mqa-label">Until</label>
              <input v-model="eventRecurEndDate" type="date" class="mqa-input" :min="eventDate || todayDate" />
            </div>
            <div v-if="eventRecurEnd === 'count'" class="mqa-field">
              <label class="mqa-label">Times</label>
              <input v-model.number="eventRecurCount" type="number" class="mqa-input" min="1" placeholder="10" />
            </div>
          </div>

          <div class="mqa-field">
            <label class="mqa-label">Remind me</label>
            <select v-model="eventReminder" class="mqa-select">
              <option v-for="opt in REMINDER_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>

          <div class="mqa-field">
            <label class="mqa-label">Notes</label>
            <textarea v-model="eventDescription" class="mqa-textarea" placeholder="Add notes..." rows="3" />
          </div>
        </template>

        <!-- Task form -->
        <template v-if="tab === 'task'">
          <div class="mqa-field">
            <label class="mqa-label">Title</label>
            <input v-model="taskTitle" class="mqa-input" placeholder="Task title" autofocus />
          </div>

          <div class="mqa-field">
            <label class="mqa-label">Priority</label>
            <div class="mqa-priority-row">
              <button v-for="p in priorities" :key="p.value" type="button" class="mqa-priority-btn"
                :class="{ active: taskPriority === p.value }" @click="taskPriority = p.value">{{ p.label }}</button>
            </div>
          </div>

          <div class="mqa-field">
            <label class="mqa-label">Start date</label>
            <input v-model="taskDueDate" type="date" class="mqa-input" />
          </div>

          <div v-if="members.length > 0" class="mqa-field">
            <label class="mqa-label">Assigned to</label>
            <div class="mqa-select-wrap">
              <span v-if="taskAssigneeId" class="mqa-select-dot" :style="{ background: memberColorMap[taskAssigneeId] }" />
              <select v-model="taskAssigneeId" class="mqa-select" :class="{ 'has-dot': !!taskAssigneeId }">
                <option value="">No one</option>
                <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name || "Unnamed" }}</option>
              </select>
            </div>
          </div>

          <div class="mqa-field">
            <label class="mqa-label">Notes</label>
            <textarea v-model="taskDescription" class="mqa-textarea" placeholder="Add notes..." rows="3" />
          </div>
        </template>
      </div>

      <div class="mqa-footer">
        <button class="mqa-cancel" type="button" @click="emit('close')">Cancel</button>
        <button class="mqa-submit" type="button" :disabled="!canSubmit" @click="handleSubmit">
          <PhCheck :size="16" weight="bold" />
          {{ submitting ? "Saving…" : tab === "event" ? "Add Event" : "Add Task" }}
        </button>
      </div>

      <Transition name="toast-fade">
        <div v-if="toast" class="mqa-toast">Created!</div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.mobile-quick-add {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(30, 24, 32, 0.3);
}

:global(.dark) .mobile-quick-add {
  background: rgba(0, 0, 0, 0.55);
}

.mqa-sheet {
  width: 100%;
  max-height: 92vh;
  max-height: 92dvh;
  background: var(--color-bgElevated);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  display: flex;
  flex-direction: column;
  box-shadow: 0 -10px 40px -16px rgba(0, 0, 0, 0.35);
  animation: slide-up var(--duration-slow) cubic-bezier(0.2, 0.7, 0.3, 1) both;
}

@keyframes slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.mqa-handle { width: 40px; height: 4px; border-radius: var(--radius-full); background: var(--color-borderStrong); margin: var(--space-2) auto var(--space-1); flex-shrink: 0; }

.mqa-header {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
  padding: 0 var(--space-4) var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.mqa-tab {
  flex: 1;
  min-height: 48px;
  padding: var(--space-2);
  border: none;
  background: transparent;
  color: var(--color-textSecondary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  border-radius: var(--radius-full);
  transition: color var(--duration-fast), background var(--duration-fast);
  min-width: 0;
}

.mqa-tab.active { color: var(--color-accent-darker); background: var(--color-accent-lighter); }

.mqa-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  min-width: 48px;
  min-height: 48px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textSecondary);
  cursor: pointer;
  flex-shrink: 0;
}

.mqa-body {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.mqa-field { display: flex; flex-direction: column; gap: var(--space-1); }
.mqa-field--half { flex: 1 1 120px; }
.mqa-field--grow { flex: 1 1 160px; }

.mqa-label {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textSecondary);
}

.mqa-hint {
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-regular);
  color: var(--color-textSecondary);
}

.mqa-input {
  width: 100%;
  min-height: 48px;
  padding: var(--space-3);
  border: none;
  border-radius: var(--radius-xs);
  background: var(--color-bgSubtle);
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  box-shadow:
    inset 0 2px 6px var(--shadow-accent-drop),
    inset 0 -1px 3px var(--shadow-shine);
}

.mqa-input:focus,
.mqa-textarea:focus,
.mqa-select:focus {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-accent-dark),
    inset 0 2px 6px var(--shadow-accent-drop),
    inset 0 -1px 3px var(--shadow-shine);
}

.mqa-textarea {
  width: 100%;
  padding: var(--space-3);
  border: none;
  border-radius: var(--radius-xs);
  background: var(--color-bgSubtle);
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  line-height: var(--text-body-line-height);
  resize: vertical;
  box-shadow:
    inset 0 2px 6px var(--shadow-accent-drop),
    inset 0 -1px 3px var(--shadow-shine);
}

.mqa-select-wrap { position: relative; }

.mqa-select-dot {
  position: absolute;
  left: var(--space-3);
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  pointer-events: none;
  z-index: 1;
}

.mqa-select {
  width: 100%;
  min-height: 48px;
  padding: var(--space-3);
  border: none;
  border-radius: var(--radius-xs);
  background: var(--color-bgSubtle);
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  box-shadow:
    inset 0 2px 6px var(--shadow-accent-drop),
    inset 0 -1px 3px var(--shadow-shine);
}

.mqa-select.has-dot { padding-left: calc(var(--space-3) + 8px + var(--space-2)); }

.mqa-row { display: flex; gap: var(--space-3); align-items: flex-end; flex-wrap: wrap; }

.mqa-toggle-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 48px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  font-size: var(--text-body-size);
  color: var(--color-textSecondary);
  cursor: pointer;
  white-space: nowrap;
}

.mqa-toggle-label.active {
  background: var(--color-accent-lighter);
  color: var(--color-accent-darker);
}

.mqa-checkbox { width: 20px; height: 20px; accent-color: var(--color-accent-darker); }

.mqa-recur-end {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  flex-wrap: wrap;
}

.mqa-recur-end .mqa-field { flex: 1 1 120px; }

/* ── Duration chips ── */
.mqa-duration {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mqa-duration-label {
  font-size: var(--text-micro-size);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-textSecondary);
}

.mqa-duration-chips {
  display: flex;
  gap: var(--space-2);
}

.mqa-duration-chip {
  flex: 1;
  min-height: 48px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  font-family: var(--font-family);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.mqa-duration-chip:active {
  background: var(--color-accent-lighter);
  color: var(--color-accent-darker);
}

/* ── Error + summary ── */
.mqa-error {
  margin: 0;
  font-size: var(--text-label-size);
  color: var(--color-danger);
}

.mqa-summary {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
  font-size: var(--text-label-size);
  color: var(--color-textSecondary);
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}

.mqa-summary-icon { color: var(--color-accent-darker); flex-shrink: 0; margin-top: 1px; }

.mqa-priority-row { display: flex; gap: var(--space-2); }

.mqa-priority-btn {
  flex: 1;
  min-height: 48px;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  color: var(--color-textSecondary);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.mqa-priority-btn.active { background: var(--color-accent-darker); color: var(--color-textInverse); }

.mqa-footer {
  display: flex;
  gap: var(--space-3);
  flex-shrink: 0;
  padding:
    var(--space-3)
    var(--space-4)
    calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--color-border);
  background: var(--color-bgElevated);
}

.mqa-cancel {
  flex: 1;
  min-height: 48px;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textSecondary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  cursor: pointer;
}

.mqa-submit {
  flex: 2;
  min-height: 48px;
  padding: var(--space-3);
  border: none;
  border-radius: var(--radius-full);
  background: linear-gradient(165deg, var(--color-accent-dark), var(--color-accent-darker) 60%);
  color: var(--color-textInverse);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  box-shadow:
    0 2px 0 0 var(--color-accent-darker),
    0 6px 16px -6px var(--shadow-accent-drop),
    inset 0 1px 2px var(--shadow-shine);
  transition: opacity var(--duration-fast);
}

.mqa-submit:disabled { opacity: 0.45; box-shadow: none; }

.mqa-toast {
  position: absolute;
  bottom: calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  padding: var(--space-2) var(--space-4);
  background: var(--color-accent-darker);
  color: var(--color-textInverse);
  border-radius: var(--radius-full);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
}

.toast-fade-enter-active, .toast-fade-leave-active { transition: opacity var(--duration-base); }
.toast-fade-enter-from, .toast-fade-leave-to { opacity: 0; }

.mqa-tab:focus-visible,
.mqa-close:focus-visible,
.mqa-duration-chip:focus-visible,
.mqa-priority-btn:focus-visible,
.mqa-cancel:focus-visible,
.mqa-submit:focus-visible,
.mqa-toggle-label:focus-within {
  outline: 2px solid var(--color-accent-darker);
  outline-offset: 2px;
}
</style>

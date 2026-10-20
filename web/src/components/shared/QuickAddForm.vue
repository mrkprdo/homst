<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue"
import { useUi } from "@/composables/useUi"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { useSettings } from "@/composables/useSettings"
import { calendarApi } from "@/api/calendar"
import { tasksApi } from "@/api/tasks"
import { PhCheckSquare, PhCalendarBlank } from "@phosphor-icons/vue"
import UiButton from "@/components/ui/UiButton.vue"
import UiToggle from "@/components/ui/UiToggle.vue"
import UiInput from "@/components/ui/UiInput.vue"
import UiSelect from "@/components/ui/UiSelect.vue"
import UiTextarea from "@/components/ui/UiTextarea.vue"
import UiField from "@/components/ui/UiField.vue"
import { REMINDER_OPTIONS, reminderMinutesFromValue } from "@/utils/reminders"

const ui = useUi()
const { ensureDefaultCalendar, upsertEvent } = useEvents()
const { lists, tasks: allTasks, upsertTask, upsertList, ensureLoaded: ensureTasksLoaded } = useTasks()
const { members, ensureLoaded: loadMembers } = useMembers()
const { defaultReminderMinutes } = useSettings()

onMounted(async () => {
  await Promise.all([loadMembers(), ensureTasksLoaded()])
})

const isEvent = computed(() => ui.activePanel.value === "calendar")
const isTask  = computed(() => ui.activePanel.value === "tasks" || ui.activePanel.value === "home")

/** Pre-fill value for the "Remind me" select from the household default. */
function defaultReminderValue(): string {
  return defaultReminderMinutes.value != null ? String(defaultReminderMinutes.value) : ""
}

const eventTitle       = ref("")
const eventDate        = ref(ui.drawer.value.date ?? "")
const eventEndDate     = ref("")
const eventStartTime   = ref(ui.drawer.value.time ?? "")
const eventEndTime     = ref("")
const eventAllDay      = ref(false)
const eventAssigneeId  = ref("")
const eventRecurrence  = ref("none")
const eventReminder    = ref(defaultReminderValue())
const eventRecurEnd    = ref<"forever" | "date" | "count">("forever")
const eventRecurEndDate = ref("")
const eventRecurCount   = ref(10)
const eventDescription = ref("")

const taskTitle       = ref("")
const taskPriority    = ref<"low" | "medium" | "high">("medium")
const taskDueDate     = ref(ui.drawer.value.date ?? "")
const taskAssigneeId  = ref("")
const taskDescription = ref("")

const memberColorMap = computed(() => {
  const map: Record<string, string> = {}
  members.value.forEach((m) => { map[m.id] = m.color })
  return map
})

const priorities: { value: "low" | "medium" | "high"; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
]

function formatDateForInput(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}
function formatTimeForInput(date: Date): string { return date.toTimeString().slice(0, 5) }

/** Add minutes to an HH:MM string, wrapping past midnight. Returns "" on bad input. */
function addMinutesToTime(time: string, minutes: number): string {
  if (!time) return ""
  const [h, m] = time.split(":").map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return ""
  const total = (h * 60 + m + minutes) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

function buildRecurEnd(): Record<string, string | number> {
  if (eventRecurEnd.value === "date" && eventRecurEndDate.value) {
    return { until: new Date(eventRecurEndDate.value + "T23:59:59").toISOString() }
  }
  if (eventRecurEnd.value === "count") {
    return { count: eventRecurCount.value }
  }
  return {}
}

const todayDate = computed(() => formatDateForInput(new Date()))
const nowTime   = computed(() => formatTimeForInput(new Date()))
const laterTime = computed(() => addMinutesToTime(nowTime.value, 60))

// ── Timeline-aware prefill: when opened from a calendar click, apply drawer date/time ──
watch(() => ui.drawer.value.type, (t) => {
  if (t !== "quick-add") return
  const d = ui.drawer.value
  eventDate.value      = d.date ?? ""
  eventStartTime.value = d.time ?? ""
  eventEndTime.value   = d.time ? addMinutesToTime(d.time, 60) : ""
  eventEndDate.value   = ""
}, { immediate: true })

// ── Smart end time: when start changes, auto-adjust an empty or inverted end time ──
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
  const start = eventStartTime.value || nowTime.value
  eventStartTime.value = start
  eventEndTime.value = addMinutesToTime(start, minutes)
}

const RECUR_LABELS: Record<string, string> = {
  daily: "daily", weekly: "weekly", biweekly: "every 2 weeks", monthly: "monthly", yearly: "yearly",
}

// ── Validation: end must come after start (same-day times / cross-day dates) ──
const eventTimeError = computed(() => {
  if (eventAllDay.value) return null
  const startDate = eventDate.value || todayDate.value
  const endDate = eventEndDate.value || startDate
  if (endDate < startDate) return "End date can't be before the start date"
  if (endDate === startDate) {
    const s = eventStartTime.value
    const e = eventEndTime.value
    if (s && e && e <= s) return "End time must be after the start time"
  }
  return null
})

// ── Live summary preview so the user sees exactly what will be created ──
const eventSummary = computed(() => {
  const startDate = eventDate.value || todayDate.value
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
  const startTime = eventStartTime.value || nowTime.value
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

const submitting = ref(false)

async function createEvent() {
  if (!eventTitle.value.trim() || eventTimeError.value) return

  const calId = await ensureDefaultCalendar()
  const startDateStr = eventDate.value || todayDate.value
  const endDateStr = eventEndDate.value || startDateStr
  const startTime = eventStartTime.value || nowTime.value
  const endTime = eventEndTime.value || addMinutesToTime(startTime, 60)

  const startAt = new Date(`${startDateStr}T${startTime}`).toISOString()
  let endAt: string | undefined
  if (eventAllDay.value) {
    // Single-day all-day: no end_at (backend treats as null). Multi-day: end-of-day inclusive.
    endAt = endDateStr !== startDateStr ? new Date(`${endDateStr}T23:59:59`).toISOString() : undefined
  } else {
    let endMs = new Date(`${endDateStr}T${endTime}`).getTime()
    const startMs = new Date(startAt).getTime()
    if (endMs <= startMs) endMs = startMs + 3600000 // never allow an inverted range
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
    // Backend rejected — event not created
  } finally {
    submitting.value = false
    resetForm()
    ui.closeDrawer()
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
    // Backend rejected — task not created
  } finally {
    submitting.value = false
    resetForm()
    ui.closeDrawer()
  }
}

function handleSubmit() {
  if (isEvent.value) createEvent()
  else if (isTask.value) createTask()
}

function resetForm() {
  eventTitle.value = ""; eventDate.value = ""; eventEndDate.value = ""
  eventStartTime.value = ""; eventEndTime.value = ""
  eventAllDay.value = false; eventDescription.value = ""
  eventAssigneeId.value = ""
  eventRecurrence.value = "none"
  eventReminder.value = defaultReminderValue()
  eventRecurEnd.value = "forever"
  eventRecurEndDate.value = ""
  eventRecurCount.value = 10
  taskTitle.value = ""; taskPriority.value = "medium"; taskDueDate.value = ""; taskAssigneeId.value = ""; taskDescription.value = ""
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit() }
}

const canSubmit = computed(() => {
  if (isEvent.value) return eventTitle.value.trim().length > 0 && !eventTimeError.value
  if (isTask.value)  return taskTitle.value.trim().length > 0
  return false
})
</script>

<template>
  <div class="quick-add-form" @keydown="handleKeydown">

    <!-- ── Event form ── -->
    <template v-if="isEvent">
      <UiField label="Title">
        <UiInput v-model="eventTitle" placeholder="Event title" autofocus />
      </UiField>

      <UiField v-if="members.length > 0" label="Assigned to">
        <UiSelect v-model="eventAssigneeId">
          <option value="">No one</option>
          <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name || 'Unnamed' }}</option>
        </UiSelect>
      </UiField>

      <UiField label="Repeat">
        <UiSelect v-model="eventRecurrence">
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Every 2 weeks</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </UiSelect>
      </UiField>

      <div v-if="eventRecurrence !== 'none'" class="field-row">
        <UiField label="End repeat">
          <UiSelect v-model="eventRecurEnd">
            <option value="forever">Forever</option>
            <option value="date">On date</option>
            <option value="count">After</option>
          </UiSelect>
        </UiField>
        <UiField v-if="eventRecurEnd === 'date'" label="Until" :grow="true">
          <UiInput v-model="eventRecurEndDate" type="date" :min="eventDate || todayDate" />
        </UiField>
        <UiField v-if="eventRecurEnd === 'count'" label="Times">
          <UiInput
            :model-value="String(eventRecurCount)"
            type="number"
            min="1"
            placeholder="10"
            @update:model-value="(v: string) => eventRecurCount = Number(v) || 0"
          />
        </UiField>
      </div>

      <!-- Date range: start date + optional end date for multi-day events -->
      <div class="field-row field-row--dates">
        <UiField label="Date" :grow="true">
          <UiInput v-model="eventDate" type="date" :placeholder="todayDate" />
        </UiField>
        <UiField label="End date" :grow="true">
          <UiInput v-model="eventEndDate" type="date" :min="eventDate || todayDate" placeholder="Same day" />
        </UiField>
        <UiField>
          <template #default>
            <span class="field-label-custom">
              <PhCheckSquare v-if="eventAllDay" :size="14" />
              All day
            </span>
            <UiToggle v-model="eventAllDay" />
          </template>
        </UiField>
      </div>

      <!-- Time range -->
      <div v-if="!eventAllDay" class="field-row">
        <UiField label="Start" :grow="true">
          <UiInput v-model="eventStartTime" type="time" :placeholder="nowTime" />
        </UiField>
        <UiField label="End" :grow="true">
          <UiInput v-model="eventEndTime" type="time" :placeholder="laterTime" />
        </UiField>
      </div>

      <!-- Quick duration presets -->
      <div v-if="!eventAllDay" class="duration-row">
        <span class="duration-label">Quick duration</span>
        <div class="duration-chips">
          <button
            v-for="d in DURATIONS"
            :key="d.minutes"
            type="button"
            class="duration-chip"
            @click="applyDuration(d.minutes)"
          >{{ d.label }}</button>
        </div>
      </div>

      <p v-if="eventTimeError" class="form-error">{{ eventTimeError }}</p>

      <UiField label="Remind me">
        <UiSelect v-model="eventReminder">
          <option v-for="opt in REMINDER_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </UiSelect>
      </UiField>

      <UiField label="Notes">
        <UiTextarea v-model="eventDescription" placeholder="Add notes..." :rows="3" />
      </UiField>
    </template>

    <!-- ── Task form ── -->
    <template v-if="isTask">
      <UiField label="Title">
        <UiInput v-model="taskTitle" placeholder="Task title" autofocus />
      </UiField>

      <UiField label="Priority">
        <div class="priority-options">
          <button
            v-for="p in priorities"
            :key="p.value"
            class="priority-btn"
            :class="{ active: taskPriority === p.value, [`priority--${p.value}`]: true }"
            type="button"
            @click="taskPriority = p.value"
          >
            {{ p.label }}
          </button>
        </div>
      </UiField>

      <UiField v-if="members.length > 0" label="Assigned to">
        <div class="assignee-select-wrap">
          <span
            class="assignee-dot"
            :style="{ background: taskAssigneeId ? memberColorMap[taskAssigneeId] : 'transparent' }"
          />
          <UiSelect v-model="taskAssigneeId" :class="{ 'has-dot': !!taskAssigneeId }">
            <option value="">No one</option>
            <option v-for="(m, i) in members" :key="m.id" :value="m.id">{{ m.name || 'Unnamed' }}</option>
          </UiSelect>
        </div>
      </UiField>

      <UiField label="Start date">
        <UiInput v-model="taskDueDate" type="date" />
      </UiField>

      <UiField label="Notes">
        <UiTextarea v-model="taskDescription" placeholder="Add notes..." :rows="3" />
      </UiField>
    </template>

    <!-- Live summary preview -->
    <div v-if="isEvent" class="summary-preview">
      <PhCalendarBlank :size="14" class="summary-icon" />
      <span>{{ eventSummary }}</span>
    </div>

    <div class="form-actions">
      <UiButton variant="ghost" @click="ui.closeDrawer()">Cancel</UiButton>
      <UiButton :disabled="!canSubmit" @click="handleSubmit">
        {{ isEvent ? 'Create Event' : 'Create Task' }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.quick-add-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.field-row {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}

.field-row--dates {
  align-items: flex-end;
  flex-wrap: wrap;
}

/* Date inputs have an intrinsic minimum width; let them shrink so the row fits the drawer */
.field-row--dates :deep(.ui-field--grow),
.field-row--dates :deep(.ui-input) {
  min-width: 0;
}

.field-label-custom {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textMuted);
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-bottom: var(--space-1);
}

/* ── Quick duration presets ── */
.duration-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.duration-label {
  font-size: var(--text-micro-size);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-textMuted);
  flex-shrink: 0;
}

.duration-chips {
  display: flex;
  gap: var(--space-1);
}

.duration-chip {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bgSurface);
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  font-family: var(--font-family);
  cursor: pointer;
  min-width: unset;
  min-height: unset;
  transition: all var(--duration-fast);
}

.duration-chip:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}

/* ── Validation error ── */
.form-error {
  margin: -var(--space-2) 0 0;
  font-size: var(--text-label-size);
  color: var(--color-danger);
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

/* ── Summary preview ── */
.summary-preview {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border: 1px dashed var(--color-borderStrong);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
  font-size: var(--text-label-size);
  color: var(--color-textSecondary);
  font-variant-numeric: tabular-nums;
}

.summary-icon {
  color: var(--color-primary);
  flex-shrink: 0;
}

/* Priority options */
.priority-options {
  display: flex;
  gap: var(--space-2);
}

.priority-btn {
  flex: 1;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSurface);
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-regular);
  font-family: var(--font-family);
  cursor: pointer;
  min-width: unset;
  min-height: unset;
  transition: all var(--duration-fast);
}

.priority-btn:hover { background: var(--color-bgSubtle); }

.priority-btn.priority--low.active {
  background: var(--color-bgSubtle);
  color: var(--color-textSecondary);
  border-color: var(--color-borderStrong);
}

.priority-btn.priority--medium.active {
  background: var(--color-warning);
  border-color: var(--color-warning);
  color: var(--color-textInverse);
}

.priority-btn.priority--high.active {
  background: var(--color-danger);
  border-color: var(--color-danger);
  color: var(--color-textInverse);
}

.assignee-select-wrap {
  position: relative;
}

.assignee-dot {
  position: absolute;
  left: var(--space-3);
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  pointer-events: none;
  z-index: 1;
  flex-shrink: 0;
}

.assignee-select-wrap :deep(.ui-select.has-dot) {
  padding-left: calc(var(--space-3) + 8px + var(--space-2));
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}
</style>

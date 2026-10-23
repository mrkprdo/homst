<script setup lang="ts">
import { ref, computed, watch } from "vue"
import { useEvents } from "@/composables/useEvents"
import { useMembers } from "@/composables/useMembers"
import { useUi } from "@/composables/useUi"
import { calendarApi, type UpdateEventPayload } from "@/api/calendar"
import { PhCalendar, PhClock, PhRepeat, PhPencil, PhTrash, PhCheck, PhX, PhWarning, PhUser, PhDownloadSimple, PhBell } from "@phosphor-icons/vue"
import UiButton from "@/components/ui/UiButton.vue"
import UiInput from "@/components/ui/UiInput.vue"
import UiTextarea from "@/components/ui/UiTextarea.vue"
import UiSelect from "@/components/ui/UiSelect.vue"
import UiToggle from "@/components/ui/UiToggle.vue"
import { downloadIcs } from "@/utils/ics"
import { REMINDER_OPTIONS, reminderLabel, reminderMinutesFromValue } from "@/utils/reminders"

const { events, upsertEvent, removeEvent } = useEvents()
const { members, ensureLoaded: loadMembers } = useMembers()
const ui = useUi()

const editing = ref(false)
const deleting = ref(false)
const saving = ref(false)

// Edit form
const editTitle         = ref("")
const editDescription   = ref("")
const editAllDay        = ref(false)
const editStart         = ref("")
const editEnd           = ref("")
const editRecurrence    = ref("none")
const editRecurEnd      = ref<"forever" | "date" | "count">("forever")
const editRecurEndDate  = ref("")
const editRecurCount    = ref(10)
const editAssigneeId    = ref("")
const editReminder      = ref("")
const editError         = ref("")

watch(() => ui.drawer.value.type, (t) => {
  if (t === "event-detail") {
    loadMembers()
    editing.value = false
    deleting.value = false
  }
}, { immediate: true })

const eventId = computed(() => ui.drawer.value.id)
const event   = computed(() => events.value.find(e => e.id === eventId.value))

const assignee = computed(() => {
  const aid = event.value?.assigneeId
  if (!aid) return null
  const m = members.value.find(m => m.id === aid)
  if (!m) return null
  return { member: m, hex: m.color }
})

function pad(n: number) { return String(n).padStart(2, "0") }

function toDateTimeLocal(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toDateInput(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
}

function startEdit() {
  const ev = event.value
  if (!ev) return
  editTitle.value       = ev.title
  editDescription.value = ev.description
  editAllDay.value      = ev.allDay
  editStart.value       = ev.allDay ? toDateInput(ev.startAt) : toDateTimeLocal(ev.startAt)
  editEnd.value         = ev.allDay ? toDateInput(ev.endAt ?? ev.startAt) : toDateTimeLocal(ev.endAt ?? ev.startAt)
  const rec = ev.recurrence as { freq?: string; until?: string; count?: number } | null
  editRecurrence.value  = rec?.freq ?? "none"
  if (rec?.until) {
    editRecurEnd.value = "date"
    editRecurEndDate.value = toDateInput(rec.until)
    editRecurCount.value = 10
  } else if (rec?.count) {
    editRecurEnd.value = "count"
    editRecurCount.value = rec.count
    editRecurEndDate.value = ""
  } else {
    editRecurEnd.value = "forever"
    editRecurEndDate.value = ""
    editRecurCount.value = 10
  }
  editAssigneeId.value  = ev.assigneeId ?? ""
  editReminder.value    = ev.reminderMinutes != null ? String(ev.reminderMinutes) : ""
  editError.value       = ""
  editing.value         = true
  deleting.value        = false
}

watch(editAllDay, (allDay) => {
  if (editStart.value.includes("T")) {
    editStart.value = editStart.value.split("T")[0]!
  } else if (!allDay && !editStart.value.includes("T")) {
    editStart.value = editStart.value + "T00:00"
  }
  if (editEnd.value.includes("T")) {
    editEnd.value = editEnd.value.split("T")[0]!
  } else if (!allDay && !editEnd.value.includes("T")) {
    editEnd.value = editEnd.value + "T00:00"
  }
})

function parseInputToMs(val: string, allDay: boolean): number | null {
  if (!val) return null
  const d = allDay ? new Date(val + "T00:00:00") : new Date(val)
  const t = d.getTime()
  return Number.isNaN(t) ? null : t
}

function parseInputToIso(val: string, allDay: boolean): string {
  if (allDay) return new Date(val + "T00:00:00").toISOString()
  return new Date(val).toISOString()
}

function buildEditRecurEnd(): Record<string, string | number> {
  if (editRecurEnd.value === "date" && editRecurEndDate.value) {
    return { until: new Date(editRecurEndDate.value + "T23:59:59").toISOString() }
  }
  if (editRecurEnd.value === "count") {
    return { count: editRecurCount.value }
  }
  return {}
}

const editTimeError = computed(() => {
  const s = parseInputToMs(editStart.value, editAllDay.value)
  const e = parseInputToMs(editEnd.value, editAllDay.value)
  if (s === null || e === null) return null
  if (e <= s) {
    return editAllDay.value ? "End date must be after the start date" : "End must be after start"
  }
  return null
})

async function saveEdit() {
  if (!event.value || editTimeError.value) return
  saving.value = true
  try {
    // All-day: single day → explicit null end (clears any stale multi-day end);
    // multi-day → inclusive end-of-day so the event covers its final day.
    let endAt: string | null | undefined
    if (editAllDay.value) {
      endAt = editEnd.value && editEnd.value !== editStart.value
        ? new Date(`${editEnd.value}T23:59:59`).toISOString()
        : null
    } else {
      endAt = parseInputToIso(editEnd.value, false)
    }

    const payload: UpdateEventPayload = {
      title:       editTitle.value.trim() || event.value.title,
      description: editDescription.value,
      all_day:     editAllDay.value,
      start_at:    parseInputToIso(editStart.value, editAllDay.value),
      end_at:      endAt,
      recurrence:  editRecurrence.value !== "none" ? { freq: editRecurrence.value, ...buildEditRecurEnd() } : null,
      reminder_minutes: reminderMinutesFromValue(editReminder.value),
      assignee_id: editAssigneeId.value || null,
    }
    const updated = await calendarApi.updateEvent(event.value.id, payload)
    upsertEvent(updated)
    editing.value = false
  } catch {
    editError.value = "Couldn't save — check the dates and try again"
  } finally {
    saving.value = false
  }
}

async function confirmDelete() {
  if (!event.value) return
  await calendarApi.deleteEvent(event.value.id).catch(() => {})
  removeEvent(event.value.id)
  ui.closeDrawer()
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

function formatRange(start: string, end: string | null, allDay: boolean) {
  const s = new Date(start)
  const e = end ? new Date(end) : new Date(start)
  const sameDay = s.toDateString() === e.toDateString()
  const fmtShort = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
  if (allDay) {
    return sameDay ? `${fmtDay(s)} · All day` : `${fmtDay(s)} – ${fmtShort(e)} · All day`
  }
  if (sameDay) return `${fmtDay(s)} · ${formatTime(start)} – ${formatTime(end ?? start)}`
  return `${fmtDay(s)}, ${formatTime(start)} – ${fmtDay(e)}, ${formatTime(end ?? start)}`
}

function recurrenceLabel(r: object | null): string | null {
  const rec = r as { freq?: string } | null
  if (!rec?.freq) return null
  const m: Record<string, string> = { daily: "Daily", weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", yearly: "Yearly" }
  return m[rec.freq] ?? rec.freq
}

const reminderText = computed(() => {
  const label = reminderLabel(event.value?.reminderMinutes)
  return label ? `Reminder ${label.toLowerCase()}` : null
})

const isExternal = computed(() => event.value?.source !== "internal")
</script>

<template>
  <div v-if="event" class="edp">

    <!-- ── View mode ── -->
    <template v-if="!editing">
      <h2 class="edp-title">{{ event.title }}</h2>

      <div class="edp-fields">
        <div class="edp-field">
          <PhCalendar :size="15" class="edp-icon" />
          <span>{{ formatRange(event.startAt, event.endAt, event.allDay) }}</span>
        </div>

        <div v-if="recurrenceLabel(event.recurrence)" class="edp-field">
          <PhRepeat :size="15" class="edp-icon" />
          <span>{{ recurrenceLabel(event.recurrence) }}</span>
        </div>

        <div v-if="reminderText" class="edp-field">
          <PhBell :size="15" class="edp-icon" />
          <span>{{ reminderText }}</span>
        </div>

        <div class="edp-field">
          <template v-if="assignee">
            <span class="edp-dot" :style="{ background: assignee.hex }" />
            <span>{{ assignee.member.name }}</span>
          </template>
          <template v-else>
            <PhUser :size="15" class="edp-icon" />
            <span class="edp-muted">Unassigned</span>
          </template>
        </div>
      </div>

      <p v-if="event.description" class="edp-desc">{{ event.description }}</p>

      <!-- Delete confirm inline -->
      <div v-if="deleting" class="edp-delete-confirm">
        <PhWarning :size="16" class="edp-warn-icon" />
        <span>Delete this event?</span>
        <div class="edp-delete-actions">
          <UiButton variant="destructive" size="sm" @click="confirmDelete">Delete</UiButton>
          <UiButton variant="ghost" size="sm" @click="deleting = false">Cancel</UiButton>
        </div>
      </div>

      <div v-else class="edp-actions">
        <UiButton v-if="!isExternal" size="sm" @click="startEdit">
          <PhPencil :size="14" />Edit
        </UiButton>
        <UiButton variant="ghost" size="sm" @click="downloadIcs(event!)">
          <PhDownloadSimple :size="14" />.ics
        </UiButton>
        <UiButton v-if="!isExternal" variant="ghost" size="sm" class="edp-delete-btn" @click="deleting = true">
          <PhTrash :size="14" />Delete
        </UiButton>
      </div>
    </template>

    <!-- ── Edit mode ── -->
    <template v-else>
      <div class="edp-form">
        <div class="edp-form-row">
          <label class="edp-form-label">Title</label>
          <UiInput v-model="editTitle" placeholder="Event title" autofocus />
        </div>

        <div v-if="members.length > 0" class="edp-form-row">
          <label class="edp-form-label">Assigned to</label>
          <UiSelect v-model="editAssigneeId">
            <option value="">No one</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name || 'Unnamed' }}</option>
          </UiSelect>
        </div>

        <div class="edp-form-row edp-form-row--inline">
          <label class="edp-form-label">All day</label>
          <UiToggle :model-value="editAllDay" @update:model-value="editAllDay = $event" />
        </div>

        <div class="edp-form-row">
          <label class="edp-form-label">Start</label>
          <UiInput :type="editAllDay ? 'date' : 'datetime-local'" :model-value="editStart" @update:model-value="editStart = $event" />
        </div>

        <div class="edp-form-row">
          <label class="edp-form-label">End</label>
          <UiInput :type="editAllDay ? 'date' : 'datetime-local'" :model-value="editEnd" @update:model-value="editEnd = $event" />
        </div>

        <p v-if="editTimeError" class="edp-form-error">{{ editTimeError }}</p>

        <div class="edp-form-row">
          <label class="edp-form-label">Repeat</label>
          <UiSelect v-model="editRecurrence">
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </UiSelect>
        </div>

        <div v-if="editRecurrence !== 'none'" class="edp-form-row">
          <label class="edp-form-label">End repeat</label>
          <UiSelect v-model="editRecurEnd">
            <option value="forever">Forever</option>
            <option value="date">On date</option>
            <option value="count">After</option>
          </UiSelect>
        </div>

        <div v-if="editRecurrence !== 'none' && editRecurEnd === 'date'" class="edp-form-row">
          <label class="edp-form-label">Until</label>
          <UiInput v-model="editRecurEndDate" type="date" :min="editStart.split('T')[0] || undefined" />
        </div>

        <div v-if="editRecurrence !== 'none' && editRecurEnd === 'count'" class="edp-form-row">
          <label class="edp-form-label">Times</label>
          <UiInput
            :model-value="String(editRecurCount)"
            type="number"
            min="1"
            placeholder="10"
            @update:model-value="(v: string) => editRecurCount = Number(v) || 0"
          />
        </div>

        <div class="edp-form-row">
          <label class="edp-form-label">Remind me</label>
          <UiSelect v-model="editReminder">
            <option v-for="opt in REMINDER_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </UiSelect>
        </div>

        <div class="edp-form-row">
          <label class="edp-form-label">Notes</label>
          <UiTextarea v-model="editDescription" placeholder="Add a description…" :rows="3" />
        </div>

        <div class="edp-form-actions">
          <UiButton :disabled="saving || !!editTimeError" @click="saveEdit">
            <PhCheck :size="14" />{{ saving ? "Saving…" : "Save" }}
          </UiButton>
          <UiButton variant="ghost" :disabled="saving" @click="editing = false">
            <PhX :size="14" />Cancel
          </UiButton>
        </div>
      </div>
    </template>
  </div>

  <div v-else class="edp-empty">
    <p>Event not found.</p>
  </div>
</template>

<style scoped>
.edp {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.edp-title {
  font-size: var(--text-title-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.2;
}

/* ── Field list ── */
.edp-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.edp-field {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  font-size: var(--text-body-size);
  color: var(--color-textSecondary);
  font-variant-numeric: tabular-nums;
}

.edp-field-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.edp-time {
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
}

.edp-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--color-textMuted);
}

.edp-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 4px;
}

.edp-muted { color: var(--color-textMuted); }

/* ── Description ── */
.edp-desc {
  font-size: var(--text-body-size);
  color: var(--color-textPrimary);
  padding: var(--space-3) var(--space-4);
  background: var(--color-bgSubtle);
  border-radius: var(--radius-sm);
  line-height: 1.6;
  white-space: pre-wrap;
}

/* ── Actions ── */
.edp-actions {
  display: flex;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.edp-delete-btn { color: var(--color-danger); }
.edp-delete-btn:hover { color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 10%, transparent); }

/* ── Delete confirm ── */
.edp-delete-confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-danger) 25%, transparent);
  border-radius: var(--radius-sm);
  font-size: var(--text-body-size);
  color: var(--color-textPrimary);
}

.edp-warn-icon { color: var(--color-danger); }

.edp-delete-actions {
  display: flex;
  gap: var(--space-2);
}

/* ── Edit form ── */
.edp-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.edp-form-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.edp-form-row--inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.edp-form-label {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textMuted);
}

.edp-form-error {
  margin: -var(--space-2) 0 0;
  font-size: var(--text-label-size);
  color: var(--color-danger);
}

.edp-form-actions {
  display: flex;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.edp-empty {
  font-size: var(--text-body-size);
  color: var(--color-textMuted);
  text-align: center;
  padding: var(--space-6);
}
</style>

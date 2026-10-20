<script setup lang="ts">
import { ref, computed, watch } from "vue"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { useUi } from "@/composables/useUi"
import { tasksApi } from "@/api/tasks"
import { PhCalendar, PhPencil, PhTrash, PhCheck, PhX, PhWarning } from "@phosphor-icons/vue"
import UiButton from "@/components/ui/UiButton.vue"
import UiInput from "@/components/ui/UiInput.vue"
import UiTextarea from "@/components/ui/UiTextarea.vue"
import UiSelect from "@/components/ui/UiSelect.vue"

const { tasks, upsertTask, removeTask } = useTasks()
const { members, ensureLoaded: loadMembers } = useMembers()
const ui = useUi()

const editing  = ref(false)
const deleting = ref(false)
const saving   = ref(false)

const editTitle       = ref("")
const editStatus      = ref<"todo" | "doing" | "done">("todo")
const editPriority    = ref<"low" | "medium" | "high">("medium")
const editDueDate     = ref("")
const editAssigneeId  = ref("")
const editDescription = ref("")

watch(() => ui.drawer.value.type, (t) => {
  if (t === "task-detail") {
    loadMembers()
    editing.value  = false
    deleting.value = false
  }
}, { immediate: true })

const taskId = computed(() => ui.drawer.value.id)
const task   = computed(() => tasks.value.find(t => t.id === taskId.value))

const assignee = computed(() => {
  const aid = task.value?.assigneeId
  if (!aid) return null
  const m = members.value.find(m => m.id === aid)
  if (!m) return null
  return { member: m, hex: m.color }
})

function pad(n: number) { return String(n).padStart(2, "0") }

function toDateInput(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
}

function startEdit() {
  const t = task.value
  if (!t) return
  editTitle.value       = t.title
  editStatus.value      = t.status
  editPriority.value    = t.priority
  editDueDate.value     = t.startAt ? toDateInput(t.startAt) : ""
  editAssigneeId.value  = t.assigneeId ?? ""
  editDescription.value = t.description
  editing.value         = true
  deleting.value        = false
}

async function saveEdit() {
  if (!task.value) return
  saving.value = true
  try {
    const updated = await tasksApi.updateTask(task.value.id, {
      title:       editTitle.value.trim() || task.value.title,
      status:      editStatus.value,
      priority:    editPriority.value,
      startAt:     editDueDate.value ? new Date(editDueDate.value + "T00:00:00").toISOString() : null,
      assigneeId:  editAssigneeId.value || null,
      description: editDescription.value,
    })
    upsertTask(updated)
    editing.value = false
  } catch {
    // keep form open
  } finally {
    saving.value = false
  }
}

async function confirmDelete() {
  if (!task.value) return
  await tasksApi.deleteTask(task.value.id).catch(() => {})
  removeTask(task.value.id)
  ui.closeDrawer()
}

const statusLabel: Record<string, string> = { todo: "To Do", doing: "In Progress", done: "Done" }
const priorityLabel: Record<string, string> = { low: "Low", medium: "Medium", high: "High" }
</script>

<template>
  <div v-if="task" class="tdp">

    <!-- ── View mode ── -->
    <template v-if="!editing">
      <h2 class="tdp-title">{{ task.title }}</h2>

      <div class="tdp-badges">
        <span class="tdp-badge" :class="`status--${task.status}`">{{ statusLabel[task.status] }}</span>
        <span class="tdp-badge" :class="`priority--${task.priority}`">{{ priorityLabel[task.priority] }}</span>
      </div>

      <div class="tdp-fields">
        <div v-if="task.startAt" class="tdp-field">
          <PhCalendar :size="15" class="tdp-icon" />
          <span>{{ formatDate(task.startAt) }}</span>
        </div>

        <div v-if="assignee" class="tdp-field">
          <span class="tdp-dot" :style="{ background: assignee.hex }" />
          <span>{{ assignee.member.name }}</span>
        </div>
      </div>

      <p v-if="task.description" class="tdp-desc">{{ task.description }}</p>

      <div v-if="deleting" class="tdp-delete-confirm">
        <PhWarning :size="16" class="tdp-warn-icon" />
        <span>Delete this task?</span>
        <div class="tdp-delete-actions">
          <UiButton variant="destructive" size="sm" @click="confirmDelete">Delete</UiButton>
          <UiButton variant="ghost" size="sm" @click="deleting = false">Cancel</UiButton>
        </div>
      </div>

      <div v-else class="tdp-actions">
        <UiButton size="sm" @click="startEdit">
          <PhPencil :size="14" />Edit
        </UiButton>
        <UiButton variant="ghost" size="sm" class="tdp-delete-btn" @click="deleting = true">
          <PhTrash :size="14" />Delete
        </UiButton>
      </div>
    </template>

    <!-- ── Edit mode ── -->
    <template v-else>
      <div class="tdp-form">
        <div class="tdp-form-row">
          <label class="tdp-form-label">Title</label>
          <UiInput v-model="editTitle" placeholder="Task title" autofocus />
        </div>

        <div class="tdp-form-row">
          <label class="tdp-form-label">Status</label>
          <UiSelect v-model="editStatus">
            <option value="todo">To Do</option>
            <option value="doing">In Progress</option>
            <option value="done">Done</option>
          </UiSelect>
        </div>

        <div class="tdp-form-row">
          <label class="tdp-form-label">Priority</label>
          <UiSelect v-model="editPriority">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </UiSelect>
        </div>

        <div class="tdp-form-row">
          <label class="tdp-form-label">Due date</label>
          <input type="date" class="tdp-dt-input" :value="editDueDate" @input="editDueDate = ($event.target as HTMLInputElement).value" />
        </div>

        <div v-if="members.length > 0" class="tdp-form-row">
          <label class="tdp-form-label">Assigned to</label>
          <UiSelect v-model="editAssigneeId">
            <option value="">No one</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name || 'Unnamed' }}</option>
          </UiSelect>
        </div>

        <div class="tdp-form-row">
          <label class="tdp-form-label">Notes</label>
          <UiTextarea v-model="editDescription" placeholder="Add a description…" :rows="3" />
        </div>

        <div class="tdp-form-actions">
          <UiButton :disabled="saving" @click="saveEdit">
            <PhCheck :size="14" />{{ saving ? "Saving…" : "Save" }}
          </UiButton>
          <UiButton variant="ghost" :disabled="saving" @click="editing = false">
            <PhX :size="14" />Cancel
          </UiButton>
        </div>
      </div>
    </template>
  </div>

  <div v-else class="tdp-empty">
    <p>Task not found.</p>
  </div>
</template>

<style scoped>
.tdp {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.tdp-title {
  font-size: var(--text-title-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.2;
}

.tdp-badges {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.tdp-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.status--todo  { background: var(--color-bgSubtle); color: var(--color-textMuted); }
.status--doing { background: color-mix(in srgb, var(--color-warning) 15%, transparent); color: var(--color-warning); }
.status--done  { background: color-mix(in srgb, var(--color-success) 15%, transparent); color: var(--color-success); }

.priority--low    { background: var(--color-bgSubtle); color: var(--color-textMuted); }
.priority--medium { background: color-mix(in srgb, var(--color-warning) 12%, transparent); color: var(--color-warning); }
.priority--high   { background: color-mix(in srgb, var(--color-danger) 12%, transparent); color: var(--color-danger); }

.tdp-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.tdp-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-body-size);
  color: var(--color-textSecondary);
}

.tdp-icon {
  flex-shrink: 0;
  color: var(--color-textMuted);
}

.tdp-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.tdp-desc {
  font-size: var(--text-body-size);
  color: var(--color-textPrimary);
  padding: var(--space-3) var(--space-4);
  background: var(--color-bgSubtle);
  border-radius: var(--radius-sm);
  line-height: 1.6;
  white-space: pre-wrap;
}

.tdp-actions {
  display: flex;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.tdp-delete-btn { color: var(--color-danger); }
.tdp-delete-btn:hover { color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 10%, transparent); }

.tdp-delete-confirm {
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

.tdp-warn-icon { color: var(--color-danger); }

.tdp-delete-actions {
  display: flex;
  gap: var(--space-2);
}

.tdp-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.tdp-form-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.tdp-form-label {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textMuted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tdp-dt-input {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background: var(--color-bgSubtle);
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  box-shadow: inset 0 2px 6px var(--shadow-inner), inset 0 -1px 3px var(--shadow-shine);
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
  color-scheme: light dark;
}

.tdp-dt-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: inset 0 2px 6px var(--shadow-inner), 0 0 0 3px var(--color-primaryLight);
}

.tdp-form-actions {
  display: flex;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.tdp-empty {
  font-size: var(--text-body-size);
  color: var(--color-textMuted);
  text-align: center;
  padding: var(--space-6);
}
</style>

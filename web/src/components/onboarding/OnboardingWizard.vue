<script setup lang="ts">
import { ref, computed } from "vue"
import { useRouter } from "vue-router"
import { type MemberEntry, memberColors, memberColorHex, type MemberColor, createDefaultMember, memberDefaultColor } from "@/types/household"
import { useEvents } from "@/composables/useEvents"
import { useMembers } from "@/composables/useMembers"
import { uid } from "@/utils/uid"
import { holidaysApi } from "@/api/holidays"
import { householdApi } from "@/api/household"
import { usersApi } from "@/api/users"
import { invalidateSettings } from "@/router"
import { PhHouse, PhDotsThree, PhPlus, PhTrash, PhCheck } from "@phosphor-icons/vue"
import UiInput from "@/components/ui/UiInput.vue"
import UiButton from "@/components/ui/UiButton.vue"
import UiSelect from "@/components/ui/UiSelect.vue"

const { ensureDefaultCalendar, upsertCalendar, calendars } = useEvents()
const { upsertMember } = useMembers()
const router = useRouter()

const houseName = ref("")
const address = ref("")
const members = ref<MemberEntry[]>([createDefaultMember()])
const holidayCountry = ref("CA")
const holidayProvince = ref("")

const countries = [
  { code: "AL", name: "Albania" },
  { code: "AD", name: "Andorra" },
  { code: "AM", name: "Armenia" },
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "BS", name: "Bahamas" },
  { code: "BB", name: "Barbados" },
  { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" },
  { code: "BZ", name: "Belize" },
  { code: "BJ", name: "Benin" },
  { code: "BO", name: "Bolivia" },
  { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "BW", name: "Botswana" },
  { code: "BR", name: "Brazil" },
  { code: "BG", name: "Bulgaria" },
  { code: "KH", name: "Cambodia" },
  { code: "CA", name: "Canada" },
  { code: "CL", name: "Chile" },
  { code: "CN", name: "China" },
  { code: "CO", name: "Colombia" },
  { code: "CR", name: "Costa Rica" },
  { code: "HR", name: "Croatia" },
  { code: "CU", name: "Cuba" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "DO", name: "Dominican Republic" },
  { code: "EC", name: "Ecuador" },
  { code: "EG", name: "Egypt" },
  { code: "SV", name: "El Salvador" },
  { code: "EE", name: "Estonia" },
  { code: "FO", name: "Faroe Islands" },
  { code: "FJ", name: "Fiji" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "GA", name: "Gabon" },
  { code: "GM", name: "Gambia" },
  { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany" },
  { code: "GI", name: "Gibraltar" },
  { code: "GR", name: "Greece" },
  { code: "GL", name: "Greenland" },
  { code: "GD", name: "Grenada" },
  { code: "GT", name: "Guatemala" },
  { code: "GG", name: "Guernsey" },
  { code: "GY", name: "Guyana" },
  { code: "HT", name: "Haiti" },
  { code: "HN", name: "Honduras" },
  { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" },
  { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" },
  { code: "IE", name: "Ireland" },
  { code: "IL", name: "Israel" },
  { code: "IT", name: "Italy" },
  { code: "JM", name: "Jamaica" },
  { code: "JP", name: "Japan" },
  { code: "JE", name: "Jersey" },
  { code: "KE", name: "Kenya" },
  { code: "KW", name: "Kuwait" },
  { code: "KG", name: "Kyrgyzstan" },
  { code: "LA", name: "Laos" },
  { code: "LV", name: "Latvia" },
  { code: "LS", name: "Lesotho" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MG", name: "Madagascar" },
  { code: "MT", name: "Malta" },
  { code: "IM", name: "Isle of Man" },
  { code: "MX", name: "Mexico" },
  { code: "MD", name: "Moldova" },
  { code: "MC", name: "Monaco" },
  { code: "MN", name: "Mongolia" },
  { code: "ME", name: "Montenegro" },
  { code: "MS", name: "Montserrat" },
  { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" },
  { code: "NA", name: "Namibia" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "NI", name: "Nicaragua" },
  { code: "NE", name: "Niger" },
  { code: "NG", name: "Nigeria" },
  { code: "NO", name: "Norway" },
  { code: "MK", name: "North Macedonia" },
  { code: "PK", name: "Pakistan" },
  { code: "PA", name: "Panama" },
  { code: "PG", name: "Papua New Guinea" },
  { code: "PY", name: "Paraguay" },
  { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "PR", name: "Puerto Rico" },
  { code: "RO", name: "Romania" },
  { code: "RU", name: "Russia" },
  { code: "RW", name: "Rwanda" },
  { code: "SM", name: "San Marino" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "RS", name: "Serbia" },
  { code: "SG", name: "Singapore" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "ZA", name: "South Africa" },
  { code: "KR", name: "South Korea" },
  { code: "ES", name: "Spain" },
  { code: "SR", name: "Suriname" },
  { code: "SJ", name: "Svalbard and Jan Mayen" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "TW", name: "Taiwan" },
  { code: "TZ", name: "Tanzania" },
  { code: "TT", name: "Trinidad and Tobago" },
  { code: "TN", name: "Tunisia" },
  { code: "TR", name: "Türkiye" },
  { code: "UG", name: "Uganda" },
  { code: "UA", name: "Ukraine" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "UY", name: "Uruguay" },
  { code: "VA", name: "Vatican City" },
  { code: "VE", name: "Venezuela" },
  { code: "VN", name: "Vietnam" },
  { code: "VI", name: "Virgin Islands (US)" },
  { code: "AX", name: "Åland Islands" },
  { code: "ZM", name: "Zambia" },
  { code: "ZW", name: "Zimbabwe" },
]

const step = ref(1)
const totalSteps = 4

function addMember() {
  const idx = members.value.length
  members.value.push({ id: uid(), name: "", color: memberDefaultColor(idx) })
}

function removeMember(id: string) {
  if (members.value.length <= 1) return
  members.value = members.value.filter((m) => m.id !== id)
}

function setMemberColor(id: string, color: MemberColor) {
  const m = members.value.find((m) => m.id === id)
  if (m) m.color = color
}

const isValid = computed(() => {
  return houseName.value.trim().length > 0 &&
    members.value.every((m) => m.name.trim().length > 0)
})

function nextStep() {
  if (step.value < totalSteps) step.value++
}
function prevStep() {
  if (step.value > 1) step.value--
}

function getMemberColor(member: MemberEntry): string {
  return memberColorHex(member.color)
}

async function finish() {
  await ensureDefaultCalendar()

  const cal = calendars.value[0]
  if (cal) {
    upsertCalendar({ ...cal, name: houseName.value.trim() })
  }

  for (const m of members.value) {
    const member = await usersApi.createMember({ name: m.name.trim(), role: "member" }).catch(() => null)
    if (member) {
      upsertMember(member)
    }
  }

  // Sync holidays via backend API (persists to DB; CalendarView loads on mount)
  try {
    await holidaysApi.sync(holidayCountry.value, holidayProvince.value || undefined)
  } catch {
    // Holidays unavailable — continue without them
  }

  // Persist onboarding state to DB (including country/province so we can re-sync later)
  await householdApi.updateSettings({
    isComplete: true,
    houseName: houseName.value.trim(),
    address: address.value.trim(),
    holidayCountry: holidayCountry.value,
    holidayProvince: holidayProvince.value || "",
  }).catch(() => { })

  invalidateSettings()
  router.push("/")
}
</script>

<template>
  <div class="onboarding-overlay">
    <div class="onboarding-card">
      <!-- Progress -->
      <div class="onboarding-progress">
        <div v-for="i in totalSteps" :key="i" class="progress-dot"
          :class="{ active: i <= step, current: i === step }" />
      </div>

      <!-- Step 1: House -->
      <div v-if="step === 1" class="onboarding-step">
        <div class="step-icon">
          <PhHouse :size="32" />
        </div>
        <h2 class="step-title">Welcome to HOMST</h2>
        <p class="step-desc">Let's set up your household.</p>
        <UiInput v-model="houseName" placeholder="Household name" autofocus />
        <UiInput v-model="address" placeholder="Home address (optional)" class="step-mt" />
        <div class="step-actions">
          <UiButton :disabled="!houseName.trim()" @click="nextStep">Next</UiButton>
        </div>
      </div>

      <!-- Step 2: Members -->
      <div v-if="step === 2" class="onboarding-step">
        <h2 class="step-title">Household Members</h2>
        <p class="step-desc">Add everyone in your household. Each member gets a color for their calendar entries.</p>
        <div class="members-list">
          <div v-for="(m, i) in members" :key="m.id" class="member-row">
            <div class="member-color">
              <div class="color-swatch-dropdown">
                <button class="member-color-btn" :style="{ background: getMemberColor(m) }" />
                <div class="color-popover">
                  <button v-for="c in memberColors" :key="c.key" class="color-opt"
                    :class="{ active: m.color === c.key }" :style="{ background: c.hex }"
                    @click="setMemberColor(m.id, c.key)">
                    <PhCheck v-if="m.color === c.key" :size="12" />
                  </button>
                </div>
              </div>
            </div>
            <UiInput v-model="m.name" :placeholder="`Member ${i + 1} name`" class="member-input" />
            <button v-if="members.length > 1" class="member-remove" @click="removeMember(m.id)" aria-label="Remove">
              <PhDotsThree v-if="false" :size="16" />
              <PhTrash :size="16" />
            </button>
          </div>
        </div>
        <UiButton variant="ghost" size="sm" @click="addMember" class="add-member-btn">
          <PhPlus :size="14" /> Add member
        </UiButton>
        <div class="step-actions">
          <UiButton variant="ghost" @click="prevStep">Back</UiButton>
          <UiButton :disabled="!isValid" @click="nextStep">Next</UiButton>
        </div>
      </div>

      <!-- Step 3: Holidays -->
      <div v-if="step === 3" class="onboarding-step">
        <h2 class="step-title">Holiday Calendar</h2>
        <p class="step-desc">We'll auto-populate legal holidays for your region.</p>

        <div class="step-field step-mt">
          <span class="step-label">Country</span>
          <UiSelect v-model="holidayCountry">
            <option v-for="c in countries" :key="c.code" :value="c.code">{{ c.name }}</option>
          </UiSelect>
        </div>

        <div class="step-field step-mt">
          <span class="step-label">State / Province (optional)</span>
          <UiInput v-model="holidayProvince" placeholder="e.g. California, Ontario" />
        </div>

        <p class="step-note">Public holidays for your country will be added to your calendar automatically.</p>

        <div class="step-actions">
          <UiButton variant="ghost" @click="prevStep">Back</UiButton>
          <UiButton @click="nextStep">Next</UiButton>
        </div>
      </div>

      <!-- Step 4: Review -->
      <div v-if="step === 4" class="onboarding-step">
        <h2 class="step-title">All set!</h2>
        <p class="step-desc">Review and confirm your setup.</p>
        <div class="review-list">
          <div class="review-item">
            <span class="review-label">Household</span>
            <span class="review-value">{{ houseName }}</span>
          </div>
          <div v-if="address" class="review-item">
            <span class="review-label">Address</span>
            <span class="review-value">{{ address }}</span>
          </div>
          <div class="review-item">
            <span class="review-label">Members</span>
            <span class="review-value">{{members.map(m => m.name).join(", ")}}</span>
          </div>
          <div class="review-item">
            <span class="review-label">Country</span>
            <span class="review-value">{{ holidayCountry }}</span>
          </div>
          <div v-if="holidayProvince" class="review-item">
            <span class="review-label">Province</span>
            <span class="review-value">{{ holidayProvince }}</span>
          </div>
        </div>
        <div class="step-actions">
          <UiButton variant="ghost" @click="prevStep">Back</UiButton>
          <UiButton @click="finish">Confirm &amp; Get Started</UiButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.onboarding-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  background: var(--color-bgBase);
  padding: var(--space-4);
}

.onboarding-card {
  width: 100%;
  max-width: 440px;
  background: var(--color-bgElevated);
  border-radius: var(--radius-lg);
  padding: var(--space-8) var(--space-6);
  box-shadow: 0 4px 0 0 var(--shadow-lip), 0 16px 48px -8px var(--shadow-drop);
  animation: card-in 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.97);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* ── Progress dots ── */
.onboarding-progress {
  display: flex;
  justify-content: center;
  gap: var(--space-2);
  margin-bottom: var(--space-8);
}

.progress-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-border);
  transition: background var(--duration-fast), transform var(--duration-fast);
}

.progress-dot.active {
  background: var(--color-accent-base);
}

.progress-dot.current {
  transform: scale(1.5);
}

/* ── Steps ── */
.onboarding-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.step-icon {
  color: var(--color-primary);
  margin-bottom: var(--space-4);
}

.step-title {
  font-size: var(--text-title-size);
  font-weight: var(--font-weight-regular);
  margin-bottom: var(--space-2);
}

.step-desc {
  font-size: var(--text-body-size);
  color: var(--color-textMuted);
  margin-bottom: var(--space-6);
  max-width: 320px;
}

.step-mt {
  margin-top: var(--space-3);
}

.step-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 100%;
  text-align: left;
}

.step-label {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textMuted);
}

.step-note {
  font-size: var(--text-micro-size);
  color: var(--color-textMuted);
  margin-top: var(--space-4);
  max-width: 320px;
  line-height: 1.4;
}

.step-actions {
  display: flex;
  gap: var(--space-3);
  justify-content: center;
  margin-top: var(--space-8);
  width: 100%;
}

/* ── Members ── */
.members-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  margin-bottom: var(--space-3);
}

.member-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.member-input {
  flex: 1;
}

.member-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-textMuted);
  cursor: pointer;
  min-width: unset;
  min-height: unset;
  flex-shrink: 0;
}

.member-remove:hover {
  background: var(--color-bgSubtle);
  color: var(--color-danger);
}

.add-member-btn {
  margin-bottom: var(--space-6);
}

/* ── Color picker ── */
.member-color {
  flex-shrink: 0;
}

.color-swatch-dropdown {
  position: relative;
}

.member-color-btn {
  width: 36px;
  height: 36px;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-full);
  cursor: pointer;
  min-width: unset;
  min-height: unset;
  transition: border-color var(--duration-fast);
}

.member-color-btn:hover {
  border-color: var(--color-borderStrong);
}

.color-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
  padding: 6px;
  background: var(--color-bgElevated);
  border-radius: var(--radius-md);
  box-shadow: 0 2px 0 0 var(--shadow-lip), 0 8px 24px -4px var(--shadow-drop);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-fast);
  z-index: 10;
}

.color-swatch-dropdown:hover .color-popover,
.color-swatch-dropdown:focus-within .color-popover {
  opacity: 1;
  pointer-events: auto;
}

.color-opt {
  width: 20px;
  height: 20px;
  border: 2px solid transparent;
  border-radius: var(--radius-full);
  cursor: pointer;
  min-width: unset;
  min-height: unset;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  transition: border-color var(--duration-fast), transform var(--duration-fast);
}

.color-opt:hover {
  transform: scale(1.15);
}

.color-opt.active {
  border-color: var(--color-borderStrong);
}

/* ── Toggles ── */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--space-3) 0;
  font-size: var(--text-body-size);
  cursor: pointer;
  border-bottom: 1px solid var(--color-border);
}

.toggle-row:last-of-type {
  border-bottom: none;
}

/* ── Review ── */
.review-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  text-align: left;
}

.review-item {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.review-label {
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  flex-shrink: 0;
}

.review-value {
  font-size: var(--text-body-size);
  text-align: right;
}
</style>

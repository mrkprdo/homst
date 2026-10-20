<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue"
import { memberColors, type MemberEntry, type MemberColor, memberColorHex, createDefaultMember, memberDefaultColor } from "@/types/household"
import { useMembers } from "@/composables/useMembers"
import { useUi } from "@/composables/useUi"
import { useSettings } from "@/composables/useSettings"
import { householdApi, type HouseholdMember, type HouseholdSettings } from "@/api/household"
import { usersApi } from "@/api/users"
import { photosApi } from "@/api/photos"
import { PhPlus, PhTrash, PhCheck, PhCheckCircle, PhWarning, PhImage } from "@phosphor-icons/vue"
import UiInput from "@/components/ui/UiInput.vue"
import UiSelect from "@/components/ui/UiSelect.vue"
import UiButton from "@/components/ui/UiButton.vue"

const { members, upsertMember: upsertMemberStore, removeMember: removeMemberFromStore } = useMembers()
const ui = useUi()
const settings = useSettings()

const activeProfileTab = ref<"household" | "photos">("household")
const fileInput = ref<HTMLInputElement | null>(null)
const confirmDeletePhoto = ref<string | null>(null)

async function onUpload(e: Event) {
  console.log("onUpload fired", e)
  const raw = (e.target as HTMLInputElement).files
  if (!raw || !raw.length) return
  console.log("files selected", raw.length)
  const files = Array.from(raw)
  fileInput.value!.value = ""
  for (const file of files) {
    try {
      const photo = await photosApi.upload(file)
      settings.photos.value.push(photo)
    } catch (e) { console.error("Photo upload failed", e) }
  }
}

const countries = [
  { code: "AL", name: "Albania" }, { code: "AD", name: "Andorra" }, { code: "AM", name: "Armenia" },
  { code: "AU", name: "Australia" }, { code: "AT", name: "Austria" }, { code: "AZ", name: "Azerbaijan" },
  { code: "BS", name: "Bahamas" }, { code: "BB", name: "Barbados" }, { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" }, { code: "BZ", name: "Belize" }, { code: "BJ", name: "Benin" },
  { code: "BO", name: "Bolivia" }, { code: "BA", name: "Bosnia and Herzegovina" }, { code: "BW", name: "Botswana" },
  { code: "BR", name: "Brazil" }, { code: "BG", name: "Bulgaria" }, { code: "KH", name: "Cambodia" },
  { code: "CA", name: "Canada" }, { code: "CL", name: "Chile" }, { code: "CN", name: "China" },
  { code: "CO", name: "Colombia" }, { code: "CR", name: "Costa Rica" }, { code: "HR", name: "Croatia" },
  { code: "CU", name: "Cuba" }, { code: "CY", name: "Cyprus" }, { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" }, { code: "DO", name: "Dominican Republic" }, { code: "EC", name: "Ecuador" },
  { code: "EG", name: "Egypt" }, { code: "SV", name: "El Salvador" }, { code: "EE", name: "Estonia" },
  { code: "FO", name: "Faroe Islands" }, { code: "FJ", name: "Fiji" }, { code: "FI", name: "Finland" },
  { code: "FR", name: "France" }, { code: "GA", name: "Gabon" }, { code: "GM", name: "Gambia" },
  { code: "GE", name: "Georgia" }, { code: "DE", name: "Germany" }, { code: "GI", name: "Gibraltar" },
  { code: "GR", name: "Greece" }, { code: "GL", name: "Greenland" }, { code: "GD", name: "Grenada" },
  { code: "GT", name: "Guatemala" }, { code: "GG", name: "Guernsey" }, { code: "GY", name: "Guyana" },
  { code: "HT", name: "Haiti" }, { code: "HN", name: "Honduras" }, { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" }, { code: "IN", name: "India" }, { code: "ID", name: "Indonesia" },
  { code: "IE", name: "Ireland" }, { code: "IL", name: "Israel" }, { code: "IT", name: "Italy" },
  { code: "JM", name: "Jamaica" }, { code: "JP", name: "Japan" }, { code: "JE", name: "Jersey" },
  { code: "KE", name: "Kenya" }, { code: "KW", name: "Kuwait" }, { code: "KG", name: "Kyrgyzstan" },
  { code: "LA", name: "Laos" }, { code: "LV", name: "Latvia" }, { code: "LS", name: "Lesotho" },
  { code: "LI", name: "Liechtenstein" }, { code: "LT", name: "Lithuania" }, { code: "LU", name: "Luxembourg" },
  { code: "MG", name: "Madagascar" }, { code: "MT", name: "Malta" }, { code: "IM", name: "Isle of Man" },
  { code: "MX", name: "Mexico" }, { code: "MD", name: "Moldova" }, { code: "MC", name: "Monaco" },
  { code: "ME", name: "Montenegro" }, { code: "MS", name: "Montserrat" }, { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" }, { code: "NA", name: "Namibia" }, { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" }, { code: "NI", name: "Nicaragua" }, { code: "NE", name: "Niger" },
  { code: "NG", name: "Nigeria" }, { code: "NO", name: "Norway" }, { code: "MK", name: "North Macedonia" },
  { code: "PK", name: "Pakistan" }, { code: "PA", name: "Panama" }, { code: "PG", name: "Papua New Guinea" },
  { code: "PY", name: "Paraguay" }, { code: "PE", name: "Peru" }, { code: "PH", name: "Philippines" },
  { code: "PL", name: "Poland" }, { code: "PT", name: "Portugal" }, { code: "PR", name: "Puerto Rico" },
  { code: "RO", name: "Romania" }, { code: "RU", name: "Russia" }, { code: "RW", name: "Rwanda" },
  { code: "SM", name: "San Marino" }, { code: "SA", name: "Saudi Arabia" }, { code: "RS", name: "Serbia" },
  { code: "SG", name: "Singapore" }, { code: "SK", name: "Slovakia" }, { code: "SI", name: "Slovenia" },
  { code: "ZA", name: "South Africa" }, { code: "KR", name: "South Korea" }, { code: "ES", name: "Spain" },
  { code: "SR", name: "Suriname" }, { code: "SJ", name: "Svalbard and Jan Mayen" }, { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" }, { code: "TW", name: "Taiwan" }, { code: "TZ", name: "Tanzania" },
  { code: "TT", name: "Trinidad and Tobago" }, { code: "TN", name: "Tunisia" }, { code: "TR", name: "Türkiye" },
  { code: "UG", name: "Uganda" }, { code: "UA", name: "Ukraine" }, { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" }, { code: "UY", name: "Uruguay" }, { code: "VA", name: "Vatican City" },
  { code: "VE", name: "Venezuela" }, { code: "VN", name: "Vietnam" }, { code: "VI", name: "Virgin Islands (US)" },
  { code: "AX", name: "Åland Islands" }, { code: "ZM", name: "Zambia" }, { code: "ZW", name: "Zimbabwe" },
]

const houseName = ref("")
const address = ref("")
const holidayCountry = ref("")
const holidayProvince = ref("")
const weatherLat = ref<number | null>(null)
const weatherLon = ref<number | null>(null)
const localMembers = ref<MemberEntry[]>([])
const saved = ref(false)

// Track original state for change detection
const originalHouseName = ref("")
const originalAddress = ref("")
const originalCountry = ref("")
const originalProvince = ref("")
const originalWeatherLat = ref<number | null>(null)
const originalWeatherLon = ref<number | null>(null)
const originalMembers = ref<MemberEntry[]>([])
const removedMemberIds = ref<string[]>([])

const editingHouseName = ref(false)
const editingAddress = ref(false)
const editingCountry = ref(false)
const editingProvince = ref(false)
const editingWeatherCoords = ref(false)
const houseNameDraft = ref("")
const addressDraft = ref("")
const countryDraft = ref("")
const provinceDraft = ref("")
const weatherLatDraft = ref<number | null>(null)
const weatherLonDraft = ref<number | null>(null)
const confirmAction = ref<null | "save" | "close">(null)

const hasChanges = computed(() => {
  if (houseName.value !== originalHouseName.value) return true
  if (address.value !== originalAddress.value) return true
  if (holidayCountry.value !== originalCountry.value) return true
  if (holidayProvince.value !== originalProvince.value) return true
  if (weatherLat.value !== originalWeatherLat.value) return true
  if (weatherLon.value !== originalWeatherLon.value) return true
  if (removedMemberIds.value.length > 0) return true
  const current = localMembers.value
  if (current.length !== originalMembers.value.length) return true
  return current.some((m, i) => {
    const orig = originalMembers.value[i]
    return !orig || m.name !== orig.name || m.color !== orig.color
  })
})

function findClosestMemberColor(hex: string): MemberColor | null {
  const c = memberColors.find(mc => mc.hex === hex)
  return c?.key ?? null
}

onMounted(async () => {
  const [settings, apiMembers] = await Promise.all([
    householdApi.getSettings().catch(() => ({} as HouseholdSettings)),
    householdApi.getMembers().catch(() => [] as HouseholdMember[]),
  ])
  houseName.value = settings?.houseName ?? ""
  address.value = settings?.address ?? ""
  holidayCountry.value = settings?.holidayCountry ?? ""
  holidayProvince.value = settings?.holidayProvince ?? ""
  weatherLat.value = settings?.lat ?? null
  weatherLon.value = settings?.lon ?? null
  const mapped: MemberEntry[] = apiMembers.map((m, i) => ({
    id: m.id,
    name: m.name,
    color: (m.color ? findClosestMemberColor(m.color) : null) ?? memberDefaultColor(i),
  }))
  localMembers.value = mapped.length ? mapped : [createDefaultMember()]
  // Snapshot original state
  originalHouseName.value = houseName.value
  originalAddress.value = address.value
  originalCountry.value = holidayCountry.value
  originalProvince.value = holidayProvince.value
  originalWeatherLat.value = weatherLat.value
  originalWeatherLon.value = weatherLon.value
  originalMembers.value = JSON.parse(JSON.stringify(localMembers.value))

  ui.registerCloseGuard(() => {
    if (hasChanges.value) {
      confirmAction.value = "close"
      return false
    }
    return true
  })
})

onUnmounted(() => {
  ui.unregisterCloseGuard()
})

async function saveHouseName() {
  const v = houseNameDraft.value.trim()
  houseName.value = v
  editingHouseName.value = false
}

async function saveAddress() {
  const v = addressDraft.value.trim()
  address.value = v
  editingAddress.value = false
}

function saveCountry() {
  holidayCountry.value = countryDraft.value
  editingCountry.value = false
}

function saveProvince() {
  holidayProvince.value = provinceDraft.value.trim()
  editingProvince.value = false
}

function saveWeatherCoords() {
  weatherLat.value = weatherLatDraft.value ?? null
  weatherLon.value = weatherLonDraft.value ?? null
  editingWeatherCoords.value = false
}

function addMember() {
  const idx = localMembers.value.length
  localMembers.value.push({ ...createDefaultMember(), color: memberDefaultColor(idx) })
}

function removeMember(id: string) {
  if (localMembers.value.length <= 1) return
  // If member came from API (real UUID format), track for backend delete
  if (!id.startsWith("m-") && !id.startsWith("t-") && !id.startsWith("ev-")) {
    removedMemberIds.value.push(id)
  }
  localMembers.value = localMembers.value.filter((m) => m.id !== id)
  removeMemberFromStore(id)
}

function setMemberColor(id: string, color: MemberColor) {
  const m = localMembers.value.find((m) => m.id === id)
  if (m) {
    m.color = color
    const storeMember = members.value.find(m => m.id === id)
    if (storeMember) {
      Object.assign(storeMember, { color: memberColorHex(color) })
    }
  }
}

function updateMemberName(id: string, name: string) {
  const m = localMembers.value.find((m) => m.id === id)
  if (m) m.name = name
}

function getMemberHex(member: { id: string; color: MemberColor }): string {
  return memberColorHex(member.color)
}

function resetAll() {
  houseName.value = originalHouseName.value
  address.value = originalAddress.value
  holidayCountry.value = originalCountry.value
  holidayProvince.value = originalProvince.value
  weatherLat.value = originalWeatherLat.value
  weatherLon.value = originalWeatherLon.value
  localMembers.value = JSON.parse(JSON.stringify(originalMembers.value))
  removedMemberIds.value = []
}

function handleSaveClick() {
  confirmAction.value = "save"
}

async function confirmSave() {
  confirmAction.value = null
  await saveAll()
}

async function confirmSaveAndClose() {
  confirmAction.value = null
  await saveAll()
  ui.unregisterCloseGuard()
  ui.closeDrawer()
}

function discardAndClose() {
  confirmAction.value = null
  resetAll()
  ui.unregisterCloseGuard()
  ui.closeDrawer()
}

function cancelConfirm() {
  confirmAction.value = null
}

async function saveAll() {
  try {
    // Persist house name if changed
    if (houseName.value !== originalHouseName.value) {
      await householdApi.updateSettings({ houseName: houseName.value })
    }

    // Persist address if changed
    if (address.value !== originalAddress.value) {
      await householdApi.updateSettings({ address: address.value })
    }

    // Persist country / province if changed
    if (holidayCountry.value !== originalCountry.value || holidayProvince.value !== originalProvince.value) {
      await householdApi.updateSettings({
        holidayCountry: holidayCountry.value,
        holidayProvince: holidayProvince.value,
      })
    }

    // Persist lat/lon if changed
    if (weatherLat.value !== originalWeatherLat.value || weatherLon.value !== originalWeatherLon.value) {
      await householdApi.updateSettings({
        lat: weatherLat.value ?? undefined,
        lon: weatherLon.value ?? undefined,
      })
    }

    // Remove deleted members from backend
    for (const id of removedMemberIds.value) {
      await usersApi.removeMember(id).catch(() => {})
    }

    // Sync current members: create new, update existing
    for (const m of localMembers.value) {
      const wasOriginal = originalMembers.value.find((o) => o.id === m.id)
      const hex = memberColorHex(m.color)
      if (wasOriginal) {
        // Existing member — update if name or color changed
        if (m.name !== wasOriginal.name || m.color !== wasOriginal.color) {
          await usersApi.updateMember(m.id, {
            name: m.name, color: hex,
          }).catch(() => {})
        }
      } else {
        // New local member — create on backend
        const created = await usersApi.createMember({
          name: m.name || "Member", color: hex, role: "member",
        }).catch(() => null)
        if (created) {
          m.id = created.id
          upsertMemberStore(created)
        }
      }
    }

    // Update snapshot
    originalHouseName.value = houseName.value
    originalAddress.value = address.value
    originalCountry.value = holidayCountry.value
    originalProvince.value = holidayProvince.value
    originalWeatherLat.value = weatherLat.value
    originalWeatherLon.value = weatherLon.value
    originalMembers.value = JSON.parse(JSON.stringify(localMembers.value))
    removedMemberIds.value = []

    saved.value = true
    setTimeout(() => { saved.value = false }, 2500)
  } catch {
    // Silently fail — user can retry
  }
}
</script>

<template>
  <div class="member-detail">
    <!-- Tabs -->
    <div class="profile-tabs">
      <button class="profile-tab" :class="{ active: activeProfileTab === 'household' }" @click="activeProfileTab = 'household'">Household</button>
      <button class="profile-tab" :class="{ active: activeProfileTab === 'photos' }" @click="activeProfileTab = 'photos'">Photos</button>
    </div>

    <template v-if="activeProfileTab === 'household'">
      <!-- House profile -->
      <section class="md-section">
        <h3 class="md-label">Household</h3>
      <div class="md-row">
        <template v-if="editingHouseName">
          <UiInput v-model="houseNameDraft" class="md-input" autofocus />
          <UiButton size="sm" @click="saveHouseName">Save</UiButton>
        </template>
        <template v-else>
          <span class="md-value md-value--large">{{ houseName || "Unnamed" }}</span>
          <button class="md-edit" @click="editingHouseName = true; houseNameDraft = houseName">Edit</button>
        </template>
      </div>
    </section>

    <section v-if="address || editingAddress" class="md-section">
      <h3 class="md-label">Address</h3>
      <div class="md-row">
        <template v-if="editingAddress">
          <UiInput v-model="addressDraft" class="md-input" autofocus />
          <UiButton size="sm" @click="saveAddress">Save</UiButton>
        </template>
        <template v-else>
          <span class="md-value">{{ address || "Not set" }}</span>
          <button class="md-edit" @click="editingAddress = true; addressDraft = address">Edit</button>
        </template>
      </div>
    </section>

    <button v-if="!address && !editingAddress" class="md-add-link" @click="editingAddress = true; addressDraft = ''">+ Add address</button>

    <section v-if="holidayProvince || editingProvince" class="md-section">
      <h3 class="md-label">State / Province</h3>
      <div class="md-row">
        <template v-if="editingProvince">
          <UiInput v-model="provinceDraft" class="md-input" autofocus />
          <UiButton size="sm" @click="saveProvince">Save</UiButton>
        </template>
        <template v-else>
          <span class="md-value">{{ holidayProvince || "Not set" }}</span>
          <button class="md-edit" @click="editingProvince = true; provinceDraft = holidayProvince">Edit</button>
        </template>
      </div>
    </section>

    <button v-if="!holidayProvince && !editingProvince" class="md-add-link" @click="editingProvince = true; provinceDraft = ''">+ Add province</button>

    <section v-if="holidayCountry || editingCountry" class="md-section">
      <h3 class="md-label">Country</h3>
      <div class="md-row">
        <template v-if="editingCountry">
          <UiSelect v-model="countryDraft" class="md-input">
            <option v-for="c in countries" :key="c.code" :value="c.code">{{ c.name }}</option>
          </UiSelect>
          <UiButton size="sm" @click="saveCountry">Save</UiButton>
        </template>
        <template v-else>
          <span class="md-value">{{ (countries.find(c => c.code === holidayCountry)?.name ?? holidayCountry) || "Not set" }}</span>
          <button class="md-edit" @click="editingCountry = true; countryDraft = holidayCountry">Edit</button>
        </template>
      </div>
    </section>

    <button v-if="!holidayCountry && !editingCountry" class="md-add-link" @click="editingCountry = true; countryDraft = ''">+ Add country</button>

    <!-- Weather coordinates -->
    <section class="md-section">
      <h3 class="md-label">Weather Coordinates</h3>
      <div class="md-row">
        <template v-if="editingWeatherCoords">
          <input v-model.number="weatherLatDraft" type="number" step="any" class="md-input md-input--narrow" placeholder="Latitude" autofocus />
          <input v-model.number="weatherLonDraft" type="number" step="any" class="md-input md-input--narrow" placeholder="Longitude" />
          <UiButton size="sm" @click="saveWeatherCoords">Save</UiButton>
        </template>
        <template v-else>
          <span class="md-value">{{ weatherLat != null ? `${weatherLat.toFixed(4)}, ${weatherLon?.toFixed(4)}` : "Auto (from address)" }}</span>
          <button class="md-edit" @click="editingWeatherCoords = true; weatherLatDraft = weatherLat; weatherLonDraft = weatherLon">Set</button>
        </template>
      </div>
    </section>

    <!-- Members -->
    <section class="md-section">
      <h3 class="md-label">Members ({{ localMembers.length }})</h3>
      <div class="md-members">
        <div v-for="m in localMembers" :key="m.id" class="md-member">
          <div class="md-member-row">
            <div class="member-color">
              <div class="color-swatch-dropdown">
                <button class="member-color-btn" :style="{ background: getMemberHex(m) }" />
                <div class="color-popover">
                  <button
                    v-for="c in memberColors"
                    :key="c.key"
                    class="color-opt"
                    :class="{ active: m.color === c.key }"
                    :style="{ background: c.hex }"
                    @click="setMemberColor(m.id, c.key)"
                  >
                    <PhCheck v-if="m.color === c.key" :size="12" />
                  </button>
                </div>
              </div>
            </div>
            <UiInput :model-value="m.name" class="md-input" :placeholder="'Member name'" @update:model-value="(v: string) => updateMemberName(m.id, v)" />
            <button v-if="localMembers.length > 1" class="member-remove" @click="removeMember(m.id)" aria-label="Remove">
              <PhTrash :size="16" />
            </button>
          </div>
        </div>
      </div>
      <button class="md-add-link" @click="addMember"><PhPlus :size="14" /> Add member</button>
    </section>

    <!-- Save / Confirmation -->
    <div class="md-footer">
      <div v-if="saved" class="md-confirm">
        <PhCheckCircle :size="16" />
        <span>Changes saved</span>
      </div>
      <UiButton v-if="hasChanges" class="md-save-btn" @click="handleSaveClick">Save Changes</UiButton>
    </div>
  </template>

  <!-- Photos tab -->
  <template v-else>
    <input ref="fileInput" type="file" accept="image/*" multiple @change="onUpload" hidden />
    <button class="photo-upload-btn" @click="fileInput!.click()">
      <PhImage :size="16" /> Upload Photos
    </button>
    <div v-if="settings.photos.value.length" class="photo-grid">
      <div
        v-for="photo in settings.photos.value" :key="photo.id"
        class="photo-item" :class="{ 'photo-item--selected': photo.selected }"
        @click="photosApi.update(photo.id, { selected: !photo.selected }).then(u => { const i = settings.photos.value.findIndex(p => p.id === photo.id); if (i !== -1) settings.photos.value[i] = u })"
      >
        <img :src="photo.url" class="photo-thumb" />
        <PhCheck v-if="photo.selected" :size="14" weight="bold" class="photo-check-icon" />
        <button class="photo-delete" @click.stop="confirmDeletePhoto = photo.id" title="Delete">&times;</button>
      </div>
    </div>
    <p v-else class="photo-empty">No photos uploaded yet</p>
  </template>
  </div>

  <!-- Confirm overlay (Teleport to match drawer position) -->
  <Teleport to="body">
    <Transition name="confirm-slide">
      <div v-if="confirmAction" class="md-confirm-overlay">
        <div class="md-confirm-panel">
          <div class="md-confirm-icon">
            <PhWarning :size="20" weight="fill" />
          </div>
          <div class="md-confirm-body">
            <p class="md-confirm-title">
              {{ confirmAction === "save" ? "Save changes?" : "Unsaved changes" }}
            </p>
            <p class="md-confirm-sub">
              {{ confirmAction === "save"
                ? "This will update your household profile."
                : "What would you like to do with your changes?" }}
            </p>
          </div>
          <div class="md-confirm-actions">
            <template v-if="confirmAction === 'save'">
              <UiButton size="sm" @click="confirmSave">Save</UiButton>
              <UiButton size="sm" variant="ghost" @click="cancelConfirm">Cancel</UiButton>
            </template>
            <template v-else>
              <UiButton size="sm" @click="confirmSaveAndClose">Save</UiButton>
              <UiButton size="sm" variant="ghost" class="md-discard-btn" @click="discardAndClose">Discard</UiButton>
              <UiButton size="sm" variant="ghost" @click="cancelConfirm">Cancel</UiButton>
            </template>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Delete photo confirmation -->
    <Transition name="confirm-slide">
      <div v-if="confirmDeletePhoto" class="md-confirm-overlay">
        <div class="md-confirm-panel">
          <div class="md-confirm-icon">
            <PhWarning :size="20" weight="fill" />
          </div>
          <div class="md-confirm-body">
            <p class="md-confirm-title">Delete photo?</p>
            <p class="md-confirm-sub">This cannot be undone.</p>
          </div>
          <div class="md-confirm-actions">
            <UiButton size="sm" @click="photosApi.remove(confirmDeletePhoto!).then(() => { settings.photos.value = settings.photos.value.filter(p => p.id !== confirmDeletePhoto!); confirmDeletePhoto = null }).catch(() => { confirmDeletePhoto = null })">Delete</UiButton>
            <UiButton size="sm" variant="ghost" @click="confirmDeletePhoto = null">Cancel</UiButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.member-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.md-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.md-label {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textMuted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.md-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.md-input { flex: 1; }
.md-input--narrow { flex: 0 1 120px; min-width: 0; }

.md-value {
  font-size: var(--text-body-size);
  color: var(--color-textSecondary);
}
.md-value--large {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.md-edit {
  border: none;
  background: none;
  color: var(--color-textMuted);
  font-size: var(--text-micro-size);
  font-family: var(--font-family);
  cursor: pointer;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  min-width: unset;
  min-height: unset;
  flex-shrink: 0;
}
.md-edit:hover { color: var(--color-primary); background: var(--color-bgSubtle); }

.md-add-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  border: none;
  background: none;
  color: var(--color-primary);
  font-size: var(--text-body-size);
  font-family: var(--font-family);
  cursor: pointer;
  padding: 0;
  min-width: unset;
  min-height: unset;
  align-self: flex-start;
}
.md-add-link:hover { opacity: 0.8; }

/* Members */
.md-members {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.md-member {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.md-member-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* Color picker (same as onboarding) */
.member-color { flex-shrink: 0; }
.color-swatch-dropdown { position: relative; }
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
.member-color-btn:hover { border-color: var(--color-borderStrong); }
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
.color-opt:hover { transform: scale(1.15); }
.color-opt.active { border-color: var(--color-borderStrong); }

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
.member-remove:hover { background: var(--color-bgSubtle); color: var(--color-danger); }

/* Footer / Save */
.md-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
}

.md-confirm {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-body-size);
  color: var(--color-primary);
}

.md-save-btn {
  flex-shrink: 0;
}

/* Confirm overlay */
.md-confirm-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(480px, 100vw);
  z-index: 102;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  pointer-events: none;
}

.md-confirm-panel {
  pointer-events: auto;
  background: var(--color-bgElevated);
  border-top: 1px solid var(--color-border);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  box-shadow: 0 -8px 32px -4px var(--shadow-drop);
}

.md-confirm-icon {
  color: var(--color-warning);
  display: flex;
}

.md-confirm-title {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.md-confirm-sub {
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  margin-top: var(--space-1);
}

.md-confirm-actions {
  display: flex;
  gap: var(--space-2);
}

.md-discard-btn {
  color: var(--color-danger);
}

/* Slide-up transition */
.confirm-slide-enter-active { transition: transform 220ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 180ms ease; }
.confirm-slide-leave-active { transition: transform 160ms ease-in, opacity 140ms ease-in; }
.confirm-slide-enter-from  { transform: translateY(100%); opacity: 0; }
.confirm-slide-leave-to    { transform: translateY(100%); opacity: 0; }

/* ── Tabs ── */
.profile-tabs {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0;
  margin-bottom: var(--space-2);
}

.profile-tab {
  flex: 1;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--color-textMuted);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  min-width: unset;
  min-height: unset;
  transition: color var(--duration-fast), border-color var(--duration-fast);
}
.profile-tab:hover { color: var(--color-textSecondary); }
.profile-tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

/* ── Photos ── */
.photo-upload-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border: 1.5px dashed var(--color-borderStrong);
  border-radius: var(--radius-md);
  background: var(--color-bgElevated);
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  min-width: unset;
  min-height: unset;
  transition: border-color var(--duration-fast), color var(--duration-fast);
}
.photo-upload-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.photo-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.photo-item {
  position: relative;
  width: 80px;
  height: 80px;
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color var(--duration-fast), opacity var(--duration-fast);
}
.photo-item:hover { opacity: 0.85; }
.photo-item--selected { border-color: var(--color-primary); }

.photo-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.photo-check-icon {
  position: absolute;
  top: 4px;
  left: 4px;
  color: var(--color-primary);
  background: var(--color-bgElevated);
  border-radius: 50%;
  padding: 2px;
}

.photo-delete {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0,0,0,0.5);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: unset;
  min-height: unset;
  padding: 0;
  opacity: 0;
  transition: opacity var(--duration-fast);
}
.photo-item:hover .photo-delete { opacity: 1; }

.photo-empty {
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  margin-top: var(--space-3);
}
</style>

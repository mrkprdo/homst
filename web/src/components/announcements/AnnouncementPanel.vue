<script setup lang="ts">
import { PhMegaphone } from "@phosphor-icons/vue"
import AnnouncementComposer from "@/components/shared/AnnouncementComposer.vue"
import AnnouncementLiveList from "@/components/shared/AnnouncementLiveList.vue"
</script>

<template>
  <div class="announcement-console">
    <section class="announcement-compose" aria-labelledby="announcement-compose-title">
      <header class="announcement-compose__head">
        <div>
          <h2 id="announcement-compose-title" class="announcement-compose__title">
            Broadcast to every screen
          </h2>
          <p class="announcement-compose__desc">
            A short message appears on every HOMST display and phone right away.
            You can also send it as a push notification.
          </p>
        </div>
        <span class="announcement-compose__icon" aria-hidden="true">
          <PhMegaphone :size="24" weight="fill" />
        </span>
      </header>

      <AnnouncementComposer fill />
    </section>

    <AnnouncementLiveList pane />
  </div>
</template>

<style scoped>
.announcement-console {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
}

.announcement-compose {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 0;
  padding: var(--space-5);
  background: var(--color-bgSurface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.announcement-compose__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  flex-shrink: 0;
}

.announcement-compose__title {
  font-size: var(--text-title-size);
  font-weight: var(--font-weight-regular);
  color: var(--color-textPrimary);
}

.announcement-compose__desc {
  max-width: 65ch;
  margin-top: var(--space-1);
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textMuted);
}

.announcement-compose__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--color-accent-lighter);
  color: var(--color-ink, #15171c);
}

@media (min-width: 1000px) {
  .announcement-console {
    height: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(340px, 1fr);
    align-items: stretch;
  }

  .announcement-compose {
    height: 100%;
    overflow-y: auto;
  }
}

@media (max-width: 560px) {
  .announcement-compose {
    padding: var(--space-4);
  }
}
</style>

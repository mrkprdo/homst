<template>
  <div class="mobile-onboarding">
    <div class="onboarding-content">
      <div class="onboarding-logo">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="64" height="64">
          <rect width="100" height="100" rx="28" fill="#e0e8e8" />
          <path d="M50 22L78 46L72 46L72 76L58 76L58 58L42 58L42 76L28 76L28 46L22 46Z" fill="#586a6a" opacity="0.9" />
          <rect x="43" y="59" width="14" height="17" rx="4" fill="#e0e8e8" />
        </svg>
      </div>
      <h1 class="onboarding-title">HOMST</h1>
      <p class="onboarding-desc">Open HOMST on your laptop or PC to set up your household. Once your household is ready, refresh this page.</p>
    </div>
  </div>
</template>

<style scoped>
.mobile-onboarding {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--space-6);
  background: var(--color-bgBase);
}

.onboarding-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 320px;
  gap: var(--space-4);
}

.onboarding-logo {
  margin-bottom: var(--space-2);
}

.onboarding-title {
  font-size: var(--text-title-size);
  font-weight: 300;
  letter-spacing: 3px;
  color: #586a6a;
  text-transform: uppercase;
}

.onboarding-desc {
  font-size: var(--text-body-size);
  color: var(--color-textMuted);
  line-height: 1.6;
  max-width: 260px;
}
</style>

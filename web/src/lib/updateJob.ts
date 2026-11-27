export const DISMISSED_UPDATE_JOB_KEY = "homst:update:dismissed-job"

export function acknowledgeUpdateJob(jobId: string): void {
  try {
    localStorage.setItem(DISMISSED_UPDATE_JOB_KEY, jobId)
  } catch {
  }
}

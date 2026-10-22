/** The last finished update job this screen acknowledged. */
export const DISMISSED_UPDATE_JOB_KEY = "homst:update:dismissed-job"

/** Hide a finished job from the Software update card on this screen. */
export function acknowledgeUpdateJob(jobId: string): void {
  try {
    localStorage.setItem(DISMISSED_UPDATE_JOB_KEY, jobId)
  } catch {
    // Private mode: the notice may reappear, but the update still applies.
  }
}

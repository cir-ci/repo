/**
 * Deleting a workspace is soft: it is hidden at once and purged for good after a grace period.
 * Pure date rules, so the dashboard, the purge job and the tests agree on the boundary.
 */

/** Days a deleted workspace is kept (and can be restored) before it is purged. */
export const WORKSPACE_PURGE_DAYS = 30

const DAY_MS = 86_400_000

/** When a workspace deleted at `deletedAt` is purged: exactly 30 days later. */
export function workspacePurgeAt(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + WORKSPACE_PURGE_DAYS * DAY_MS)
}

/** Whether the purge is due at `now`: at exactly the purge time, yes. */
export function isWorkspacePurgeDue(deletedAt: Date, now: Date): boolean {
  return now.getTime() >= workspacePurgeAt(deletedAt).getTime()
}

/** Whole days left, rounded up (a workspace with 1 hour left has 1 day left); 0 once due. */
export function workspaceDaysLeft(deletedAt: Date, now: Date): number {
  const left = workspacePurgeAt(deletedAt).getTime() - now.getTime()
  return left <= 0 ? 0 : Math.ceil(left / DAY_MS)
}

/** Workspaces deleted at or before this instant are due for purge at `now`. */
export function workspacePurgeCutoff(now: Date): Date {
  return new Date(now.getTime() - WORKSPACE_PURGE_DAYS * DAY_MS)
}

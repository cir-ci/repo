/**
 * The service layer: operations that change several things at once. A service opens the
 * transaction, calls repositories from `@circi/db` for the data, and queues the jobs and notices
 * that follow. Apps (server, worker) call services for anything that changes a build's state.
 */
export {
  completeBuild,
  describeStall,
  expireStalledBuilds,
  failBuild,
  finalizeBuild,
  matchAuthor,
  recordPullRequestAuthor,
  requeueBuild,
  startBuild,
  type AuthorClaim,
} from './builds.ts'
export {
  addComment,
  deleteComment,
  editComment,
  matchMentions,
  MAX_COMMENT_LENGTH,
} from './comments.ts'
export {
  addTeamLink,
  autoLinkTeam,
  type LinkedIntegration,
  mapTeam,
  unmapTeam,
} from './integration-links.ts'
export { gateInputs } from './gate.ts'
export { handleGitEvents } from './git-events.ts'
export { gitKinds } from './git-kinds.ts'
export { linkTeamToGithub, unlinkTeamFromGit } from './git-links.ts'
export { createIssueFromBuild, MAX_ISSUE_TITLE_LENGTH } from './issues.ts'
export { migrateStorage } from './migrate-storage.ts'
export {
  markInboxRead,
  markNotificationRead,
  notify,
  removeNotification,
  snoozeNotification,
  unsnoozeNotification,
  updateNotificationPreferences,
} from './notifications.ts'
export { queueIntegrationEvent } from './integration-events.ts'
export { previewRetention, runRetention } from './retention.ts'
export {
  dismissReviewRequest,
  MAX_BULK_REVIEW,
  notifyOverdueReviews,
  requestReview,
  reviewBuild,
  reviewBuilds,
  snoozeReviewRequest,
  unsnoozeReviewRequest,
} from './reviews.ts'
export {
  assignTriage,
  createIgnoreRegion,
  deleteIgnoreRegion,
  dismissTriage,
  snoozeTriage,
} from './triage.ts'
export {
  createView,
  deleteView,
  pinTeam,
  renameView,
  reorderViews,
  setViewPinned,
  unpinTeam,
  updateView,
  updateViewFilters,
} from './views.ts'

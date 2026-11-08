import type {
  Activity,
  Baseline,
  Build,
  Comment,
  IgnoreRegion,
  Inbox,
  Integration,
  Insights,
  Team,
  Review,
  ReviewRule,
  Search,
  Sidebar,
  Triage,
  View,
} from '@circi/api'
import type { BuildFilterValues } from '@circi/core'
import type {
  ActivityEvent,
  BaselineItem,
  CommentItem,
  IgnoreRegionRow,
  TeamOverview,
  ReviewRuleRow,
  SavedViewRow,
  getInsights,
  getSidebar,
  searchWorkspace,
  listTriage,
  listBuildsForTeam,
  getBuildDetail,
  listInbox,
  listReviewRequests,
  listWorkspaceIntegrations,
  getNotificationPreferences,
  getTeamGitAttention,
  findTeamForMember,
  getTriageRotation,
} from '@circi/db'

/**
 * Compile-time proof that what the server's read models produce fits the wire format in
 * `@circi/api` once JSON has turned its dates into strings. If a field is renamed, retyped or
 * dropped on one side, this file stops typechecking. Nothing here exists at runtime.
 */

type Json<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T

/** `true` when `Actual` is usable wherever `Wire` is expected; a type error otherwise. */
type Fits<Actual, Wire> = [Actual] extends [Wire] ? true : never

export type ContractChecks = [
  Fits<Json<listBuildsForTeam.Item>, Build.ListItem>,
  Fits<Json<TeamOverview>, Team.Overview>,
  Fits<findTeamForMember.Visible, Team.Info>,
  Fits<Json<getTeamGitAttention.Attention>, Team.GitAttention>,
  Fits<Json<getBuildDetail.Detail>['diffs'], Build.DiffItem[]>,
  Fits<Json<getBuildDetail.Detail>['reviews'], Build.Review[]>,
  Fits<Json<getBuildDetail.Detail>['build'], Omit<Build.Detail['build'], never>>,
  Fits<Json<listReviewRequests.Item>, Review.Request>,
  Fits<Json<BaselineItem>, Baseline.Item>,
  Fits<getInsights.Summary, Insights.Summary>,
  Fits<getInsights.Reviewer, Insights.Reviewer>,
  Fits<Json<getInsights.Report>, Insights.Report>,
  Fits<Json<listTriage.Queue>, Triage.Queue>,
  Fits<Json<getTriageRotation.Rotation>, Triage.Rotation>,
  Fits<ReviewRuleRow, ReviewRule.Item>,
  Fits<IgnoreRegionRow, IgnoreRegion.Item>,
  Fits<Json<listInbox.Item>, Inbox.Item>,
  Fits<Json<listInbox.List>, Inbox.List>,
  Fits<getNotificationPreferences.Preferences, Inbox.Preferences>,
  Fits<searchWorkspace.Results, Search.Results>,
  Fits<Json<ActivityEvent>, Activity.Event>,
  Fits<Json<CommentItem>, Omit<Comment.Item, 'mine' | 'canDelete'>>,
  Fits<Json<SavedViewRow>, View.Item>,
  Fits<Json<listWorkspaceIntegrations.Item>, Integration.Item>,
  Fits<Json<getSidebar.Result>, Sidebar.Model>,
  Fits<BuildFilterValues, View.Filters>,
  Fits<View.Filters, BuildFilterValues>,
]

/** Each entry must be `true`; a mismatch above makes its entry `never`, and this line fails. */
export const contractChecks: ContractChecks = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
]

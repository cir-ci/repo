import type {
  Activity,
  Baseline,
  Build,
  Comment,
  IgnoreRegion,
  Inbox,
  Integration,
  Insights,
  Project,
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
  BuildDetail,
  CommentItem,
  GitAttention,
  IgnoreRegionRow,
  InboxItem,
  InboxList,
  IntegrationItem,
  NotificationPreferences,
  InsightsReport,
  InsightsReviewer,
  InsightsSummary,
  BuildListItem,
  ProjectOverview,
  ReviewRequestItem,
  ReviewRuleRow,
  SavedViewRow,
  SearchResults,
  Sidebar as SidebarModel,
  TriageQueue,
  TriageRotation,
  VisibleProject,
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
  Fits<Json<BuildListItem>, Build.ListItem>,
  Fits<Json<ProjectOverview>, Project.Overview>,
  Fits<VisibleProject, Project.Info>,
  Fits<Json<GitAttention>, Project.GitAttention>,
  Fits<Json<BuildDetail>['diffs'], Build.DiffItem[]>,
  Fits<Json<BuildDetail>['reviews'], Build.Review[]>,
  Fits<Json<BuildDetail>['build'], Omit<Build.Detail['build'], never>>,
  Fits<Json<ReviewRequestItem>, Review.Request>,
  Fits<Json<BaselineItem>, Baseline.Item>,
  Fits<InsightsSummary, Insights.Summary>,
  Fits<InsightsReviewer, Insights.Reviewer>,
  Fits<Json<InsightsReport>, Insights.Report>,
  Fits<Json<TriageQueue>, Triage.Queue>,
  Fits<Json<TriageRotation>, Triage.Rotation>,
  Fits<ReviewRuleRow, ReviewRule.Item>,
  Fits<IgnoreRegionRow, IgnoreRegion.Item>,
  Fits<Json<InboxItem>, Inbox.Item>,
  Fits<Json<InboxList>, Inbox.List>,
  Fits<NotificationPreferences, Inbox.Preferences>,
  Fits<SearchResults, Search.Results>,
  Fits<Json<ActivityEvent>, Activity.Event>,
  Fits<Json<CommentItem>, Omit<Comment.Item, 'mine' | 'canDelete'>>,
  Fits<Json<SavedViewRow>, View.Item>,
  Fits<Json<IntegrationItem>, Integration.Item>,
  Fits<Json<SidebarModel>, Sidebar.Model>,
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

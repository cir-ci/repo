/** `@circi/integrations/git`: the git host adapter interface, its errors and registry, and what CirCI shows on a host. */
export {
  type GitProvider,
  headerValue,
  isConnectionRevoked,
  ProviderApiError,
  type ProviderRegistry,
  providerRegistry,
} from './provider.ts'
export {
  type CheckReport,
  checkName,
  checkReport,
  describeCounts,
  parseCommand,
  PR_COMMENT_MARKER,
  prCommentBody,
  type ReportedBuild,
  type ReportedReview,
  type ReportedSite,
} from './render.ts'

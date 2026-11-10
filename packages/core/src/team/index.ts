export {
  ACCOUNT_IMAGE_MAX,
  ACCOUNT_NAME_MAX,
  accountImageProblem,
  accountNameProblem,
} from './account-name.ts'
export { assertValidSlug, RESERVED_SLUGS, isValidSlug, slugify } from './slug.ts'
export { canManage } from './roles.ts'
export {
  assertTeamColor,
  assertTeamIcon,
  isTeamColor,
  isTeamIcon,
  TEAM_COLORS,
  TEAM_ICON_NAMES,
  teamColorFor,
  type TeamColor,
  type TeamIconName,
} from './team-appearance.ts'
export {
  isWorkspacePurgeDue,
  WORKSPACE_PURGE_DAYS,
  workspaceDaysLeft,
  workspacePurgeAt,
  workspacePurgeCutoff,
} from './workspace-deletion.ts'
export {
  WORKSPACE_PICTURE_MAX_BYTES,
  WORKSPACE_PICTURE_MIN_SIDE,
  WORKSPACE_PICTURE_PREFIX,
  WORKSPACE_PICTURE_SIZE,
  WORKSPACE_PICTURE_TYPES,
  workspacePictureKey,
  workspacePictureSha,
  workspacePictureUrl,
} from './workspace-picture.ts'
export {
  assertBranchName,
  assertDiffThreshold,
  assertRetentionDays,
  assertReviewTargetHours,
  branchNameProblem,
  MAX_RETENTION_DAYS,
  MAX_REVIEW_TARGET_HOURS,
} from './team-settings-rules.ts'
export { ownSignInRefusal, type OwnSignInMethod, type SignInSwitches } from './own-sign-in.ts'
export { isPublicEmailDomain } from './public-email-domains.ts'
export { describeAuthValidation, type AuthValidationProblem } from './auth-validation.ts'

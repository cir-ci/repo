export type { Actor } from './actor.ts'
export {
  assertAllowed,
  canAdjustCommentRegion,
  canAddTeamMembers,
  canDeleteWorkspace,
  canManageWorkspace,
  canReadTeam,
  canReadWorkspace,
  canRemoveTeamMember,
  canSeeTeam,
  canWriteTeam,
  type Decision,
  isInstanceAdmin,
  isWorkspaceOwner,
} from './policies.ts'

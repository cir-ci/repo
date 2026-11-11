export type { Actor } from './actor.ts'
export {
  assertAllowed,
  canAdjustCommentRegion,
  canAddProjectMembers,
  canDeleteWorkspace,
  canManageWorkspace,
  canReadProject,
  canReadWorkspace,
  canRemoveProjectMember,
  canSeeProject,
  canWriteProject,
  type Decision,
  isInstanceAdmin,
  isWorkspaceOwner,
} from './policies.ts'

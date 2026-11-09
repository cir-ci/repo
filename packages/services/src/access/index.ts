export type { Actor } from './actor.ts'
export {
  assertAllowed,
  canDeleteWorkspace,
  canManageWorkspace,
  canReadTeam,
  canReadWorkspace,
  canWriteTeam,
  type Decision,
  isInstanceAdmin,
} from './policies.ts'

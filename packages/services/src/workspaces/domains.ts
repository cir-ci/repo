import { type Database } from '@circi/db'
import { type WorkspaceDomain } from '@circi/db/queries'
import {
  addWorkspaceDomain,
  removeWorkspaceDomain,
  type TxtResolver,
  verifyWorkspaceDomain,
} from '@circi/db/repositories'

/** Claims an email domain for a workspace (unverified until its DNS proof is found). */
export async function addEmailDomain(
  db: Database,
  input: addEmailDomain.Input,
): Promise<WorkspaceDomain> {
  return db.transaction((tx) => addWorkspaceDomain(tx, input.workspaceId, input.domain))
}
export namespace addEmailDomain {
  export interface Input {
    workspaceId: string
    /** As typed; normalised and checked on the way in. */
    domain: string
  }
}

/** Checks the DNS proof of a claimed domain; `verified` once it is, else the `reason` it is not. */
export async function verifyEmailDomain(
  db: Database,
  input: verifyEmailDomain.Input,
): Promise<verifyEmailDomain.Result> {
  return db.transaction((tx) =>
    verifyWorkspaceDomain(tx, input.workspaceId, input.id, input.resolveTxt),
  )
}
export namespace verifyEmailDomain {
  export interface Result {
    verified: boolean
    reason?: string
  }
  export interface Input {
    workspaceId: string
    id: string
    /** Replaceable DNS lookup (tests). */
    resolveTxt?: TxtResolver | undefined
  }
}

/** Drops a claimed email domain. */
export async function removeEmailDomain(
  db: Database,
  input: removeEmailDomain.Input,
): Promise<void> {
  await db.transaction((tx) => removeWorkspaceDomain(tx, input.workspaceId, input.id))
}
export namespace removeEmailDomain {
  export interface Input {
    workspaceId: string
    id: string
  }
}

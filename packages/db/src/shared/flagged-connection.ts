import { integrations } from '#schema/index.ts'

/** A connection that has just stopped working: who to tell, and what to call it. */
export interface FlaggedConnection {
  id: string
  workspaceId: string
  kind: string
  displayName: string
}

/** The `returning` selection that gives a `FlaggedConnection`. */
export const flaggedConnectionColumns = {
  id: integrations.id,
  workspaceId: integrations.workspaceId,
  kind: integrations.kind,
  displayName: integrations.displayName,
}

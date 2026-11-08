import { DEFAULT_FLAKY_BLOCKS_MERGE } from '@circi/core'
import { eq } from 'drizzle-orm'

import { orgSettings } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** An organization's defaults for its projects (a project may override each one). */

export interface OrgSettings {
  /** Whether a pull request that only changes flaky screenshots still blocks the merge. */
  flakyBlocksMerge: boolean
}

const DEFAULTS: OrgSettings = { flakyBlocksMerge: DEFAULT_FLAKY_BLOCKS_MERGE }

/** The organization's settings; the defaults when it has never saved any. */
export async function getOrgSettings(db: Database, orgId: string): Promise<OrgSettings> {
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId))
  return row ? { flakyBlocksMerge: row.flakyBlocksMerge } : DEFAULTS
}

/** Saves the given settings only and returns them all. */
export async function setOrgSettings(
  db: Database,
  orgId: string,
  patch: Partial<OrgSettings>,
): Promise<OrgSettings> {
  const next = { ...(await getOrgSettings(db, orgId)), ...patch }
  await db
    .insert(orgSettings)
    .values({ orgId, ...next })
    .onConflictDoUpdate({ target: orgSettings.orgId, set: { ...next, updatedAt: new Date() } })
  return next
}

import * as schema from '#schema/index.ts'
import { type Database } from '#src/index.ts'

export namespace seedSavedView {
  export interface Input {
    userId: string
    workspaceId: string
    teamId?: string | null
    name?: string
    filters?: typeof schema.savedViews.$inferInsert.filters
    pinned?: boolean
    position?: number
  }
}

let n = 0

/** A saved view, inserted as given. */
export async function seedSavedView(db: Database, input: seedSavedView.Input) {
  n += 1
  const [row] = await db
    .insert(schema.savedViews)
    .values({
      userId: input.userId,
      workspaceId: input.workspaceId,
      teamId: input.teamId ?? null,
      name: input.name ?? `View ${n}`,
      filters: input.filters ?? {},
      pinned: input.pinned ?? false,
      position: input.position ?? 0,
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}

/** Pins a team for a user at a position. */
export async function seedPinnedTeam(
  db: Database,
  input: { userId: string; teamId: string; position?: number },
): Promise<void> {
  await db.insert(schema.userPinnedTeams).values({ ...input, position: input.position ?? 0 })
}

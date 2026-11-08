import { type Database, schema } from '@circi/db'

let n = 0

/** A signed-in dashboard session for `userId`, valid for an hour unless `expiresAt` says else. */
export async function seedSession(
  db: Database,
  userId: string,
  options: { expiresAt?: Date } = {},
) {
  n += 1
  const [row] = await db
    .insert(schema.session)
    .values({
      id: `session-${n}`,
      token: `token-${n}`,
      userId,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 3_600_000),
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}

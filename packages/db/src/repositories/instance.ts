import { eq } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { instanceSettings } from '../schema/index.ts'

/** Instance-wide settings (key/value) and the dashboard-address change notice (PLAN §7.9). */

export async function getSetting(db: Database, key: string): Promise<string | undefined> {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, key))
  return row?.value
}

export async function setSetting(db: Database, key: string, value: string): Promise<void> {
  await db
    .insert(instanceSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedAt: new Date() } })
}

export async function deleteSetting(db: Database, key: string): Promise<void> {
  await db.delete(instanceSettings).where(eq(instanceSettings.key, key))
}

const PUBLIC_URL_KEY = 'public_url'
const PUBLIC_URL_CHANGE_KEY = 'public_url_change'

export interface PublicUrlChange {
  from: string
  to: string
  at: string
}

/**
 * Remembers the dashboard address this instance runs with. When it differs from the last one
 * seen, the change is recorded (for the admin banner, until dismissed) and returned so the
 * caller can log the checklist. The first run only stores the address.
 */
export async function recordPublicUrl(
  db: Database,
  origin: string,
): Promise<PublicUrlChange | undefined> {
  const previous = await getSetting(db, PUBLIC_URL_KEY)
  if (previous === origin) return undefined
  await setSetting(db, PUBLIC_URL_KEY, origin)
  if (previous === undefined) return undefined
  const change: PublicUrlChange = { from: previous, to: origin, at: new Date().toISOString() }
  await setSetting(db, PUBLIC_URL_CHANGE_KEY, JSON.stringify(change))
  return change
}

/** The unacknowledged address change, if any. */
export async function getPublicUrlChange(db: Database): Promise<PublicUrlChange | undefined> {
  const raw = await getSetting(db, PUBLIC_URL_CHANGE_KEY)
  if (!raw) return undefined
  try {
    // Written only by `recordPublicUrl`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return JSON.parse(raw) as PublicUrlChange
  } catch {
    return undefined
  }
}

export async function dismissPublicUrlChange(db: Database): Promise<void> {
  await deleteSetting(db, PUBLIC_URL_CHANGE_KEY)
}

/** The steps to finish after moving the dashboard (PLAN §7.9), for the log and the admin banner. */
export function publicUrlChecklist(change: Pick<PublicUrlChange, 'from' | 'to'>): string[] {
  return [
    `Keep DNS and TLS for ${change.from} pointing at CirCI and list it in PREVIOUS_PUBLIC_URLS, so old links redirect to ${change.to}.`,
    'People sign in again once: dashboard cookies belong to one host.',
    `OIDC providers: change each redirect URI to ${change.to}/api/auth/callback/<provider>.`,
    `GitHub App: update its OAuth callback URL to ${change.to} by hand (the webhook URL is updated automatically).`,
  ]
}

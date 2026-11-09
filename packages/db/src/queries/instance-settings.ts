import { eq } from 'drizzle-orm'

import { instanceSettings } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

export async function getSetting(db: Database, key: string): Promise<string | undefined> {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, key))
  return row?.value
}

export const PUBLIC_URL_CHANGE_KEY = 'public_url_change'

export interface PublicUrlChange {
  from: string
  to: string
  at: string
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

export const MOVE_CHECKLIST_DISMISSED_KEY = 'move_checklist_dismissed'

/** The `PUBLIC_URL` origin the "Moving to …" checklist was dismissed for, if it was. */
export async function getMoveChecklistDismissedFor(db: Database): Promise<string | undefined> {
  return getSetting(db, MOVE_CHECKLIST_DISMISSED_KEY)
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

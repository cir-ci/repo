import { eq, sql } from 'drizzle-orm'

import {
  FIRST_RUN_SETUP_KEY,
  getSetting,
  MOVE_CHECKLIST_DISMISSED_KEY,
  PUBLIC_URL_CHANGE_KEY,
  type PublicUrlChange,
} from '#queries/instance-settings.ts'
import { instanceSettings } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** Instance-wide settings (key/value) and the dashboard-address change notice (PLAN §7.9). */

export async function setSetting(db: Database, key: string, value: string): Promise<void> {
  await db
    .insert(instanceSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedAt: new Date() } })
}

/** Stores a setting only when none exists, so concurrent first starts keep one value; true when this call stored it. */
export async function setSettingIfAbsent(
  db: Database,
  key: string,
  value: string,
): Promise<boolean> {
  const rows = await db
    .insert(instanceSettings)
    .values({ key, value })
    .onConflictDoNothing()
    .returning({ key: instanceSettings.key })
  return rows.length > 0
}

/**
 * Takes the lock every change of the instance settings holds until its transaction ends, so two
 * saves (of the same or different groups) run one after the other and each reads what the last
 * wrote. The rows may not exist yet, so a row lock can't do it: this is an advisory lock.
 */
export async function lockInstanceSettings(tx: Database): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('instance_settings'))`)
}

export async function deleteSetting(db: Database, key: string): Promise<void> {
  await db.delete(instanceSettings).where(eq(instanceSettings.key, key))
}

const PUBLIC_URL_KEY = 'public_url'

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

export async function dismissPublicUrlChange(db: Database): Promise<void> {
  await deleteSetting(db, PUBLIC_URL_CHANGE_KEY)
}

/** Hides the "Moving to …" checklist for `origin`; a different `PUBLIC_URL` later shows it again. */
export async function dismissMoveChecklist(db: Database, origin: string): Promise<void> {
  await setSetting(db, MOVE_CHECKLIST_DISMISSED_KEY, origin)
}

/** Shows the "Moving to …" checklist again. */
export async function restoreMoveChecklist(db: Database): Promise<void> {
  await deleteSetting(db, MOVE_CHECKLIST_DISMISSED_KEY)
}

/** Notes that the first account and workspace were made and the rest of the setup steps are to do. */
export async function markFirstRunSetupPending(db: Database): Promise<void> {
  await setSetting(db, FIRST_RUN_SETUP_KEY, 'pending')
}

/** Ends the setup steps (finished or skipped): the dashboard opens as usual from now on. */
export async function markFirstRunSetupDone(db: Database): Promise<void> {
  await deleteSetting(db, FIRST_RUN_SETUP_KEY)
}

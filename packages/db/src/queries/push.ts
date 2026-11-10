import { eq } from 'drizzle-orm'

import { pushSubscriptions } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

export namespace listPushDevices {
  /** A device of the person that takes push, as the settings page lists it (no keys). */
  export interface Device {
    id: string
    endpoint: string
    label: string
    createdAt: Date
    lastUsedAt: Date | null
  }
}

/** The person's devices, the oldest first. */
export async function listPushDevices(
  db: Database,
  userId: string,
): Promise<listPushDevices.Device[]> {
  return db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      label: pushSubscriptions.label,
      createdAt: pushSubscriptions.createdAt,
      lastUsedAt: pushSubscriptions.lastUsedAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(pushSubscriptions.createdAt)
}

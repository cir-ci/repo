import {
  generateVapidKeys,
  isValidVapidKeys,
  openSecret,
  sealSecret,
  type VapidKeys,
} from '@circi/core/node'
import type { Database } from '@circi/db'
import { getSetting } from '@circi/db/queries'
import { deleteAllPushSubscriptions, setSetting, setSettingIfAbsent } from '@circi/db/repositories'

/**
 * The key pair this server signs web pushes with. The operator may set it (`VAPID_PUBLIC_KEY` /
 * `VAPID_PRIVATE_KEY`); otherwise the first call makes one and keeps it in the instance settings,
 * the private half sealed under the instance secret like other stored credentials. Concurrent
 * first calls (several replicas) end up with the one that was stored first.
 */

const KEY = 'vapid_keys'

interface Stored {
  publicKey: string
  sealedPrivateKey: string
}

export namespace getVapidKeys {
  export interface Options {
    /** `BETTER_AUTH_SECRET`: seals the stored private key. */
    authSecret: string
    /** The keys from the environment, when the operator set them: used as they are, nothing is stored. */
    fromEnv?: VapidKeys | undefined
  }
}

export async function getVapidKeys(
  db: Database,
  options: getVapidKeys.Options,
): Promise<VapidKeys> {
  if (options.fromEnv) return options.fromEnv
  const stored = await readStored(db, options.authSecret)
  if (stored.keys) return stored.keys
  const made = generateVapidKeys()
  const value = JSON.stringify({
    publicKey: made.publicKey,
    sealedPrivateKey: sealSecret(options.authSecret, made.privateKey),
  } satisfies Stored)
  if (stored.unreadable) {
    // The instance secret changed since the keys were made: they, and every subscription made
    // under their public half, are lost. Start over; devices turn push on again.
    await db.transaction(async (tx) => {
      await setSetting(tx, KEY, value)
      await deleteAllPushSubscriptions(tx)
    })
    return made
  }
  if (await setSettingIfAbsent(db, KEY, value)) return made
  // Another replica stored its pair first: use that one.
  const winner = await readStored(db, options.authSecret)
  if (!winner.keys) throw new Error('could not read the stored web push keys')
  return winner.keys
}

async function readStored(
  db: Database,
  authSecret: string,
): Promise<{ keys?: VapidKeys; unreadable?: true }> {
  const raw = await getSetting(db, KEY)
  if (raw === undefined) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      const { publicKey, sealedPrivateKey }: Partial<Stored> = parsed
      const privateKey =
        typeof sealedPrivateKey === 'string' ? openSecret(authSecret, sealedPrivateKey) : undefined
      if (typeof publicKey === 'string' && privateKey) {
        const keys = { publicKey, privateKey }
        if (isValidVapidKeys(keys)) return { keys }
      }
    }
  } catch {
    // Falls through: unreadable.
  }
  return { unreadable: true }
}

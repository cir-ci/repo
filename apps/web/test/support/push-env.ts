import type { Push } from '@circi/api'
import { vi } from 'vitest'

import type { PushEnv } from '#features/pwa/push-client.ts'
import { setPushEnv } from '#features/pwa/push-client.ts'
import type { PushPermission } from '#lib/prompt-rules.ts'

/** A subscription the fake browser makes. */
export const SUBSCRIPTION: Push.SubscribeBody = {
  endpoint: 'https://push.example.com/send/this-browser',
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
}

/**
 * The browser's push parts, faked (a real push service can't be reached from a test): the
 * permission box answers with `answer`, a subscribe returns `SUBSCRIPTION`. Installed for the
 * test; `setup.ts` puts the real ones back.
 */
export function fakePushEnv(
  options: { permission?: PushPermission; answer?: PushPermission } = {},
) {
  let permission: PushPermission = options.permission ?? 'default'
  let subscription: Push.SubscribeBody | null = null
  const env = {
    supported: vi.fn<PushEnv['supported']>(async () => true),
    permission: vi.fn<PushEnv['permission']>(() => permission),
    requestPermission: vi.fn<PushEnv['requestPermission']>(async () => {
      permission = options.answer ?? 'granted'
      return permission
    }),
    current: vi.fn<PushEnv['current']>(async () => subscription),
    subscribe: vi.fn<PushEnv['subscribe']>(async () => {
      subscription = SUBSCRIPTION
      return SUBSCRIPTION
    }),
    unsubscribe: vi.fn<PushEnv['unsubscribe']>(async () => {
      subscription = null
    }),
  } satisfies PushEnv
  setPushEnv(env)
  return env
}

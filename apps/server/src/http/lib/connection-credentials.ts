import { openSecret } from '@circi/core'

/** The plaintext of a connection's sealed credentials; undefined when there are none or they cannot be opened. */
export const openConnectionCredentials = (
  authSecret: string | undefined,
  sealed: string | null,
): string | undefined =>
  authSecret && sealed !== null ? openSecret(authSecret, sealed) : undefined

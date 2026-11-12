import type { SsoProvider } from '@circi/auth'
import { activeSso, type InstanceConfigStore } from '@circi/services'

/** How long after a failed provider setup (an identity provider that was down) the next request tries again. */
export const SSO_RETRY_MS = 30_000

export namespace createSsoSync {
  export interface Options {
    instanceConfig: Pick<InstanceConfigStore, 'get'>
    /** The auth instance, asked when needed (it is made after this function, with this as its `refresh`). */
    auth: () => { reloadSso(providers: SsoProvider[]): Promise<string[]> }
    onError?: (err: unknown) => void
    /** Replaceable in tests. */
    now?: () => number
  }
}

/**
 * The sign-in providers can change in the dashboard, or in another replica: this brings the auth
 * instance in step with the instance settings before each sign-in request. It does nothing while
 * the providers are the ones already set up, and a provider that could not be set up (its issuer
 * was down) is tried again after `SSO_RETRY_MS`. Concurrent requests share one reload.
 */
export function createSsoSync(options: createSsoSync.Options): () => Promise<void> {
  const now = options.now ?? Date.now
  let applied = ''
  let retryAt = 0
  let applying: Promise<void> | undefined

  return async () => {
    const providers = activeSso(await options.instanceConfig.get())
    const signature = JSON.stringify(providers)
    if (signature === applied || now() < retryAt) return
    applying ??= options
      .auth()
      .reloadSso(providers)
      .then((built) => {
        const complete = providers.every((p) => built.includes(p.id))
        applied = complete ? signature : ''
        retryAt = complete ? 0 : now() + SSO_RETRY_MS
      })
      .catch((err: unknown) => {
        retryAt = now() + SSO_RETRY_MS
        options.onError?.(err)
      })
      .finally(() => {
        applying = undefined
      })
    await applying
  }
}

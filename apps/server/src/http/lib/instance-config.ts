import { activeSso, emailLoginOffered, type InstanceConfig } from '@circi/services'

import type { Deps } from './deps.ts'

/**
 * The instance settings a request depends on, read now: from the settings service when the server
 * has one (production: the environment over what the dashboard saved, a TTL-cached read), else
 * from the plain values in `deps` (tests that build a scope by hand).
 */
type Scope = Pick<
  Deps.Dashboard,
  'instanceConfig' | 'emailLogin' | 'passwordLogin' | 'sso' | 'workspaceCreation'
>

/** What the sign-in page can offer, now. */
export async function signInMethods(scope: Scope): Promise<{
  password: boolean
  email: boolean
  sso: { id: string; name: string }[]
}> {
  if (scope.instanceConfig) {
    const effective = await scope.instanceConfig.get()
    return {
      password: effective.signIn.password,
      email: emailLoginOffered(effective),
      sso: activeSso(effective).map((p) => ({ id: p.id, name: p.name })),
    }
  }
  return {
    password: scope.passwordLogin !== false,
    email: scope.emailLogin === true,
    sso: scope.sso ?? [],
  }
}

/** Who may create workspaces now. */
export async function workspaceCreationOf(scope: Scope): Promise<'admin' | 'anyone'> {
  if (scope.instanceConfig) return (await scope.instanceConfig.get()).workspaceCreation
  return scope.workspaceCreation ?? 'admin'
}

export type { InstanceConfig }

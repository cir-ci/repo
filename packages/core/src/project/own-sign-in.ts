/** A workspace's sign-in switches, by the names the API uses. */
export interface SignInSwitches {
  emailLoginEnabled: boolean
  passwordLoginEnabled: boolean
  signinGithub: boolean
  signinGoogle: boolean
}

/** How a session signed in, as far as the switches go (the db's `SessionMethod`, structurally). */
export type OwnSignInMethod =
  | string
  | { scopedTo: string }
  | { oidcProvider: 'github' | 'google' }
  | undefined

/**
 * Turning off the method the person making the change signed in with would shut them out of the
 * workspace at once (every workspace read hides it from a session its switches refuse), so it is
 * refused. Returns the request field and the message, or undefined when the change is fine.
 * Only a switch that goes from on to off counts.
 */
export function ownSignInRefusal(
  method: OwnSignInMethod,
  current: SignInSwitches,
  patch: Partial<SignInSwitches>,
): { field: keyof SignInSwitches; message: string } | undefined {
  const turnsOff = (field: keyof SignInSwitches) => patch[field] === false && current[field]
  const tail = 'Sign in with another method this workspace accepts before turning'
  if (method === 'password' && turnsOff('passwordLoginEnabled')) {
    return {
      field: 'passwordLoginEnabled',
      message: `You signed in with a password. ${tail} passwords off.`,
    }
  }
  if (method === 'email' && turnsOff('emailLoginEnabled')) {
    return {
      field: 'emailLoginEnabled',
      message: `You signed in with an email code. ${tail} email codes off.`,
    }
  }
  if (typeof method === 'object' && 'oidcProvider' in method) {
    const github = method.oidcProvider === 'github'
    const field = github ? 'signinGithub' : 'signinGoogle'
    if (turnsOff(field)) {
      const name = github ? 'GitHub' : 'Google'
      return {
        field,
        message: `You signed in with ${name}. ${tail} ${name} off.`,
      }
    }
  }
  return undefined
}

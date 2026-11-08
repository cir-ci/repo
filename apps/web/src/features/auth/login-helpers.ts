/**
 * The mailed link opens `/#signin-email=…&code=…`. It's in the fragment so servers never see it,
 * and nothing is submitted until the person clicks, so mail scanners can't spend the code.
 */
export function readLink(
  hash: string = window.location.hash,
): { email: string; code: string } | undefined {
  const params = new URLSearchParams(hash.slice(1))
  const email = params.get('signin-email')
  const code = params.get('code')
  return email && code ? { email, code } : undefined
}

/** An invitation link (`/#invite=…&email=…`) opened while signed out. */
export function readInvitedEmail(hash: string = window.location.hash): string | undefined {
  const params = new URLSearchParams(hash.slice(1))
  return params.get('invite') ? (params.get('email') ?? undefined) : undefined
}

export function clearLink(): void {
  const next = withoutSignInLink(window.location.hash)
  if (next !== window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search + next)
  }
}

/**
 * The fragment without the mailed sign-in link's address and code. An invitation link's
 * `#invite=…` stays: it is read again after signing in, when the person joins with one click.
 */
export function withoutSignInLink(hash: string): string {
  const params = new URLSearchParams(hash.slice(1))
  params.delete('signin-email')
  params.delete('code')
  const rest = params.toString()
  return rest ? `#${rest}` : ''
}

/** A form field's text (the browser could also give a File, which a text input never does). */
export function text(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

/** Says what went wrong without helping anyone guess which emails have accounts. */
export function describeFailure(status: number): string {
  if (status === 401 || status === 400) return 'Incorrect email or password.'
  if (status === 429) return 'Too many attempts. Wait a minute and try again.'
  return 'Couldn’t sign in. Check your connection and try again.'
}

export function describeCodeFailure(status: number): string {
  if (status === 429) return 'Too many attempts. Wait a minute and try again.'
  if (status === 400 || status === 401 || status === 403) {
    return 'That code is wrong or has expired. Check it, or ask for a new one.'
  }
  return 'Couldn’t sign in. Check your connection and try again.'
}

/** What the sign-in page says when a provider login came back refused (`?error=…`). */
export function ssoErrorMessage(search: string = window.location.search): string | undefined {
  const code = new URLSearchParams(search).get('error')
  if (!code) return undefined
  return code.toLowerCase().includes('link')
    ? 'That sign-in provider isn’t trusted to attach to an existing account. Sign in another way, then ask whoever runs CirCI.'
    : 'Signing in with that provider didn’t work. If you have no account yet, ask to be invited.'
}

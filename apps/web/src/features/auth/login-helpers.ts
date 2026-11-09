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

/** What better-auth's client reports for a refused call (the parts the page reads). */
export interface AuthFailure {
  status: number
  code?: string | undefined
  message?: string | undefined
}

const asFailure = (failure: number | AuthFailure): AuthFailure =>
  typeof failure === 'number' ? { status: failure } : failure

/**
 * Better-auth refuses a sign-in from an address other than the one the server is set up for
 * (`INVALID_ORIGIN`, 403): opening CirCI by an old name, an IP or a proxy's own host does it.
 */
export const isOriginRefusal = (failure: AuthFailure): boolean =>
  failure.code === 'INVALID_ORIGIN' ||
  (failure.status === 403 && /invalid origin/i.test(failure.message ?? ''))

/** The page does not know the instance's public address (only admins do), so it says it without one. */
export const ORIGIN_REFUSED =
  'This server doesn’t accept sign-ins from this address. Open CirCI at the address it was set up with, or ask whoever runs it.'

/** Says what went wrong without helping anyone guess which emails have accounts. */
export function describeFailure(failure: number | AuthFailure): string {
  const f = asFailure(failure)
  if (isOriginRefusal(f)) return ORIGIN_REFUSED
  if (f.status === 401 || f.status === 400) return 'Incorrect email or password.'
  if (f.status === 429) return 'Too many attempts. Wait a minute and try again.'
  return 'Couldn’t sign in. Check your connection and try again.'
}

export function describeCodeFailure(failure: number | AuthFailure): string {
  const f = asFailure(failure)
  if (isOriginRefusal(f)) return ORIGIN_REFUSED
  if (f.status === 429) return 'Too many attempts. Wait a minute and try again.'
  if (f.status === 400 || f.status === 401 || f.status === 403) {
    return 'That code is wrong or has expired. Check it, or send a new one.'
  }
  return 'Couldn’t sign in. Check your connection and try again.'
}

/** Asking for a code again waits this long (the server also limits how many it will send). */
export const RESEND_COOLDOWN_SECONDS = 30

/** What the sign-in page says when a provider login came back refused (`?error=…`). */
export function ssoErrorMessage(search: string = window.location.search): string | undefined {
  const code = new URLSearchParams(search).get('error')
  if (!code) return undefined
  return code.toLowerCase().includes('link')
    ? 'That sign-in provider isn’t trusted to attach to an existing account. Sign in another way, then ask whoever runs CirCI.'
    : 'Signing in with that provider didn’t work. If you have no account yet, ask to be invited.'
}

/**
 * The mailed link opens `/#signin-email=…&code=…`. It's in the fragment so servers never see it,
 * and nothing is submitted until the person clicks, so mail scanners can't spend the code.
 */
export function readLink(): { email: string; code: string } | undefined {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const email = params.get('signin-email')
  const code = params.get('code')
  return email && code ? { email, code } : undefined
}

/** An invitation link (`/#invite=…&email=…`) opened while signed out. */
export function readInvitedEmail(): string | undefined {
  const params = new URLSearchParams(window.location.hash.slice(1))
  return params.get('invite') ? (params.get('email') ?? undefined) : undefined
}

export function clearLink(): void {
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
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

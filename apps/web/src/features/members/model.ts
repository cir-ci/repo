/** Who may do what on the members page, and what the forms accept before anything is sent. */

export function canManageMembers(
  members: ReadonlyArray<{ userId: string; role: string }>,
  userId: string | undefined,
): boolean {
  const role = members.find((m) => m.userId === userId)?.role
  return role === 'owner' || role === 'admin'
}

export function pendingInvitations<T extends { status: string }>(
  invitations: ReadonlyArray<T>,
): T[] {
  return invitations.filter((i) => i.status === 'pending')
}

/** "1 person", "3 people". */
export function peopleCount(count: number): string {
  return count === 1 ? '1 person' : `${count} people`
}

/** "1 invitation", "2 invitations". */
export function invitationCount(count: number): string {
  return count === 1 ? '1 invitation' : `${count} invitations`
}

type Problems<K extends string> = Partial<Record<K, string>>

export function validateInvite(email: string): Problems<'email'> {
  if (!email) return { email: 'Enter an email address' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { email: "That doesn't look like an email address" }
  return {}
}

const METHOD_LABEL: Record<string, string> = {
  password: 'Password',
  sso: 'SSO',
  oidc: 'SSO',
  github: 'GitHub',
  google: 'Google',
  gitlab: 'GitLab',
}

/** The tags of one member's sign-in methods ("Password", "GitHub"…), one per label, in the server's order. */
export function signInTags(methods: readonly string[]): string[] {
  const labels = methods.map(
    (m) => METHOD_LABEL[m] ?? (m ? m.charAt(0).toUpperCase() + m.slice(1) : m),
  )
  return [...new Set(labels)]
}

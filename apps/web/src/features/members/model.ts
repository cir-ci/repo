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
    return { email: 'That doesn’t look like an email address' }
  return {}
}

export function validateDomain(domain: string): Problems<'domain'> {
  if (!domain) return { domain: 'Enter a domain, like example.com' }
  if (!/^[^\s@/:]+\.[^\s@/:]+$/.test(domain))
    return { domain: 'Enter just the domain, like example.com' }
  return {}
}

export function validateSso(input: {
  issuer: string
  clientId: string
  clientSecret: string
}): Problems<'issuer' | 'clientId' | 'clientSecret'> {
  const problems: Problems<'issuer' | 'clientId' | 'clientSecret'> = {}
  if (!input.issuer) problems.issuer = 'Enter the issuer address'
  else if (!isWebAddress(input.issuer))
    problems.issuer = 'Enter a full address, like https://login.example.com'
  if (!input.clientId) problems.clientId = 'Enter the client id'
  if (!input.clientSecret) problems.clientSecret = 'Enter the client secret'
  return problems
}

function isWebAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

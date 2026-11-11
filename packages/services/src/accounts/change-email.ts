import { ValidationError } from '@circi/core'
import { ConflictError, type Database, NotFoundError } from '@circi/db'
import { getAccountEmail, isEmailTaken } from '@circi/db/queries'

import { type Actor, assertAllowed, isInstanceAdmin } from '../access/index.ts'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * An instance admin changes another account's email address directly, with no confirmation
 * mail: the operator vouches for the new address (what the instance needs when it has no mail,
 * where the person can't confirm one). `apply` makes the change in better-auth, which owns the
 * user table; this checks who may, that the account exists and that the address is valid and
 * free, then hands it over. Returns the address as stored (trimmed, lower case).
 */
export async function changeAccountEmail(
  db: Database,
  input: changeAccountEmail.Input,
): Promise<changeAccountEmail.Result> {
  assertAllowed(isInstanceAdmin(input.actor), {
    notFound: 'No such account',
    forbidden: 'Only instance admins can do this',
  })
  const email = input.email.trim().toLowerCase()
  if (!EMAIL.test(email) || email.length > 254) {
    throw new ValidationError('Enter a valid email address')
  }
  const current = await getAccountEmail(db, input.userId)
  if (current === undefined) throw new NotFoundError('No such account')
  if (current.toLowerCase() === email) {
    throw new ConflictError("That's already their email address")
  }
  if (await isEmailTaken(db, email, input.userId)) {
    throw new ConflictError('That email address is already in use')
  }
  await input.apply(email)
  return { email, previousEmail: current }
}
export namespace changeAccountEmail {
  export interface Input {
    actor: Pick<Actor, 'instanceAdmin'>
    userId: string
    email: string
    /** Writes the new address (through better-auth) and does whatever follows from it. */
    apply: (email: string) => Promise<void>
  }
  export interface Result {
    email: string
    previousEmail: string
  }
}

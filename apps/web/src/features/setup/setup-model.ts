import type { InstanceAdmin } from '@circi/api'
import { isValidSlug, slugify } from '@circi/core'

/** The steps of first-run setup, in order. The first two happen before there is an account. */
export const SETUP_STEPS = ['Account', 'Workspace', 'Storage', 'Team'] as const

/** `Step 2 of 4` for a step number from 1. */
export const stepLabel = (step: number): string => `Step ${step} of ${SETUP_STEPS.length}`

/** What the server needs of a password (`MIN_PASSWORD_LENGTH` in `@circi/auth`). */
export const MIN_PASSWORD_LENGTH = 12

export interface AccountDraft {
  code: string
  name: string
  email: string
  password: string
}
export type AccountErrors = Partial<Record<keyof AccountDraft, string>>

/** What is wrong with the account step, per field; empty when it can go on. */
export function validateAccount(draft: AccountDraft): AccountErrors {
  const errors: AccountErrors = {}
  if (!draft.code.trim()) errors.code = 'Enter the setup code'
  if (!draft.name.trim()) errors.name = 'Enter your name'
  const email = draft.email.trim()
  if (!email) errors.email = 'Enter your email'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address'
  if (!draft.password) errors.password = 'Enter a password'
  else if (draft.password.length < MIN_PASSWORD_LENGTH)
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters`
  return errors
}

export interface WorkspaceDraft {
  name: string
  /** The address the person typed; empty while it follows the name. */
  slug: string
}
export type WorkspaceErrors = Partial<Record<keyof WorkspaceDraft, string>>

/** The workspace's address: what the person typed, else made from the name. */
export const workspaceSlug = (draft: WorkspaceDraft): string =>
  draft.slug.trim() || slugify(draft.name)

/** What is wrong with the workspace step, per field; empty when it can go on. */
export function validateWorkspace(draft: WorkspaceDraft): WorkspaceErrors {
  const errors: WorkspaceErrors = {}
  if (!draft.name.trim()) errors.name = 'Enter a name'
  const slug = workspaceSlug(draft)
  if (draft.name.trim() || draft.slug.trim()) {
    if (!isValidSlug(slug)) {
      errors.slug = slug
        ? 'Use lowercase letters, digits and single hyphens (this name may be reserved)'
        : 'Enter an address'
    }
  }
  return errors
}

/** The storage findings of the doctor: the storage itself, and the disk it sits on (local storage). */
export function storageFindings(checks: InstanceAdmin.Checks): InstanceAdmin.Finding[] {
  return checks.findings.filter((f) => f.id === 'storage' || f.id === 'disk')
}

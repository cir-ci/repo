import {
  Banner,
  Button,
  Dialog,
  SettingsRow,
  SettingsSection,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { authClient } from '#lib/auth-client.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import { accountsQuery } from './api.ts'
import { isPassword, MIN_PASSWORD_LENGTH, passwordProblems, type PasswordDraft } from './model.ts'

import styles from '#features/workspace-settings/Settings.module.css'

const EMPTY: PasswordDraft = { current: '', next: '', confirm: '' }

/** Change your password. Only shown when you have one (a single-sign-on-only account has none). */
export function PasswordSection() {
  const announce = useAnnounce()
  const accounts = useQuery(accountsQuery())
  const password = accounts.data?.find(isPassword)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(EMPTY)
  const [showProblems, setShowProblems] = useState(false)
  const problems = showProblems ? passwordProblems(draft) : {}

  const change = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.changePassword({
        currentPassword: draft.current,
        newPassword: draft.next,
        revokeOtherSessions: false,
      })
      if (error) throw new Error(error.message ?? 'Couldn’t change your password')
    },
    onSuccess: () => {
      setOpen(false)
      announce('Password changed')
    },
  })

  function close(next: boolean) {
    setOpen(next)
    if (!next) {
      setDraft(EMPTY)
      setShowProblems(false)
      change.reset()
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setShowProblems(true)
    if (Object.keys(passwordProblems(draft)).length === 0) change.mutate()
  }

  if (!password) return null
  const field = (key: keyof PasswordDraft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value }),
  })

  return (
    <>
      <SettingsSection
        title="Password"
        description={`At least ${MIN_PASSWORD_LENGTH} characters. Changing it keeps this device signed in.`}
      >
        <SettingsRow
          label="Password"
          detail={
            <>
              Last changed <RelativeTime iso={new Date(password.updatedAt).toISOString()} />
            </>
          }
        >
          <Button onClick={() => setOpen(true)}>Change password</Button>
        </SettingsRow>
      </SettingsSection>
      <Dialog
        open={open}
        onOpenChange={close}
        title="Change password"
        actions={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="change-password"
              variant="primary"
              loading={change.isPending}
            >
              Change password
            </Button>
          </>
        }
      >
        <form id="change-password" onSubmit={submit} noValidate className={styles.fields}>
          <TextField
            label="Current password"
            name="current"
            type="password"
            autoComplete="current-password"
            error={problems.current}
            {...field('current')}
          />
          <TextField
            label="New password"
            name="next"
            type="password"
            autoComplete="new-password"
            error={problems.next}
            {...field('next')}
          />
          <TextField
            label="Confirm new password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            error={problems.confirm}
            {...field('confirm')}
          />
          {change.error ? <Banner tone="danger">{change.error.message}</Banner> : null}
        </form>
      </Dialog>
    </>
  )
}

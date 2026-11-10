import { Banner, FormDialog, Select, TextField } from '@circi/ui'
import { useState, type FormEvent } from 'react'

import { toast } from '#lib/toast.ts'

import { type AssignableRole, inviteMember } from './api.ts'
import { validateInvite } from './model.ts'

import styles from './InviteForm.module.css'

const ROLES = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
]

/**
 * "Invite": the dialog behind the Members page's header button. An address and a role; sending
 * closes it and the toast says it went (and when it replaced an earlier invitation to the same address).
 */
export function InviteForm({ workspaceId, open, onClose, onInvited }: InviteForm.Props) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AssignableRole>('member')
  const [problem, setProblem] = useState<string>()
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function close() {
    setProblem(undefined)
    setFailure(null)
    onClose()
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const address = email.trim()
    const problems = validateInvite(address)
    setProblem(problems.email)
    if (problems.email) return
    setBusy(true)
    setFailure(null)
    let replaced: Awaited<ReturnType<typeof inviteMember>>
    try {
      replaced = await inviteMember({ email: address, role, workspaceId })
    } catch (error) {
      const text = error instanceof Error ? error.message : "Couldn't send the invitation."
      setFailure(text)
      toast.error(error instanceof Error ? `Couldn't send the invitation: ${text}` : text)
      return
    } finally {
      setBusy(false)
    }
    setEmail('')
    // A new invitation to an address that already has one replaces it: say so.
    toast(
      replaced
        ? `Invitation sent to ${address}. Replaced the earlier invitation${replaced.replacedRole ? ` (${replaced.replacedRole})` : ''} to ${address}; its link no longer works.`
        : `Invitation sent to ${address}`,
    )
    close()
    await onInvited()
  }

  if (!open) return null
  return (
    <FormDialog
      open
      title="Invite someone"
      onClose={close}
      onSubmit={(e) => void submit(e)}
      pending={busy}
      submitLabel={busy ? 'Sending…' : 'Send invite'}
      noValidate
      formClassName={styles.form}
    >
      <TextField
        className={styles.email}
        name="email"
        type="email"
        label="Email"
        placeholder="name@acme.dev"
        required
        value={email}
        error={problem}
        onChange={(e) => {
          setEmail(e.target.value)
          setProblem(undefined)
        }}
      />
      <Select
        className={styles.role}
        name="role"
        label="Role"
        items={ROLES}
        value={role}
        onValueChange={(next) => setRole(next === 'admin' ? 'admin' : 'member')}
      />
      {failure ? <Banner tone="danger">{failure}</Banner> : null}
    </FormDialog>
  )
}

export namespace InviteForm {
  export interface Props {
    workspaceId: string
    open: boolean
    onClose: () => void
    onInvited: () => Promise<unknown>
  }
}

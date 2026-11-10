import { Banner, Button, Select, SettingsSection, TextField } from '@circi/ui'
import { useState, type FormEvent } from 'react'

import { toast } from '#lib/toast.ts'

import { type AssignableRole, inviteMember } from './api.ts'
import { validateInvite } from './model.ts'

import styles from './InviteForm.module.css'

const ROLES = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
]

export function InviteForm({ workspaceId, onInvited }: InviteForm.Props) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AssignableRole>('member')
  const [problem, setProblem] = useState<string>()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const address = email.trim()
    const problems = validateInvite(address)
    setProblem(problems.email)
    if (problems.email) return
    setBusy(true)
    setMessage(null)
    let replaced: Awaited<ReturnType<typeof inviteMember>>
    try {
      replaced = await inviteMember({ email: address, role, workspaceId })
    } catch (failure) {
      const text = failure instanceof Error ? failure.message : "Couldn't send the invitation."
      setMessage({ tone: 'danger', text })
      toast.error(failure instanceof Error ? `Couldn't send the invitation: ${text}` : text)
      return
    } finally {
      setBusy(false)
    }
    setEmail('')
    // A new invitation to an address that already has one replaces it: say so.
    const text = replaced
      ? `Invitation sent to ${address}. Replaced the earlier invitation${replaced.replacedRole ? ` (${replaced.replacedRole})` : ''} to ${address}; its link no longer works.`
      : `Invitation sent to ${address}.`
    toast(`Invitation sent to ${address}`)
    setMessage({ tone: 'success', text })
    await onInvited()
  }

  return (
    <SettingsSection title="Invite someone" bare>
      <form onSubmit={(e) => void submit(e)} noValidate className={styles.form}>
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
        <Button type="submit" variant="primary" loading={busy} className={styles.submit}>
          {busy ? 'Sending…' : 'Send invite'}
        </Button>
      </form>
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
    </SettingsSection>
  )
}

export namespace InviteForm {
  export interface Props {
    workspaceId: string
    onInvited: () => Promise<unknown>
  }
}

import { Banner, Button, Select, SectionHeader, TextField, useAnnounce } from '@circi/ui'
import { useState, type FormEvent } from 'react'

import { type AssignableRole, inviteMember } from './api.ts'
import { validateInvite } from './model.ts'

import styles from './InviteForm.module.css'

const ROLES = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
]

export function InviteForm({ organizationId, onInvited }: InviteForm.Props) {
  const announce = useAnnounce()
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
    try {
      await inviteMember({ email: address, role, organizationId })
    } catch (failure) {
      setMessage({
        tone: 'danger',
        text: failure instanceof Error ? failure.message : 'Couldn’t send the invitation.',
      })
      return
    } finally {
      setBusy(false)
    }
    setEmail('')
    announce(`Invitation sent to ${address}`)
    setMessage({ tone: 'success', text: `Invitation sent to ${address}.` })
    await onInvited()
  }

  return (
    <section className={styles.root}>
      <SectionHeader title="Invite someone" />
      <form onSubmit={(e) => void submit(e)} noValidate className={styles.form}>
        <TextField
          className={styles.email}
          name="email"
          type="email"
          label="Email"
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
          {busy ? 'Sending…' : 'Send invitation'}
        </Button>
      </form>
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
    </section>
  )
}

export namespace InviteForm {
  export interface Props {
    organizationId: string
    onInvited: () => Promise<unknown>
  }
}

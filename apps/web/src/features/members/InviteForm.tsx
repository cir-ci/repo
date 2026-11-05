import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useState, type FormEvent } from 'react'

import { authClient } from '../../lib/auth-client.ts'
import { useAnnounce } from '../../primitives/feedback.tsx'

export function InviteForm({ organizationId, onInvited }: InviteForm.Props) {
  const announce = useAnnounce()
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const rawEmail = data.get('email')
    const email = typeof rawEmail === 'string' ? rawEmail.trim() : ''
    const role = data.get('role') === 'admin' ? 'admin' : 'member'
    setBusy(true)
    setMessage(null)
    const { error: failure } = await authClient.organization.inviteMember({
      email,
      role,
      organizationId,
    })
    setBusy(false)
    if (failure) {
      setMessage({ severity: 'error', text: failure.message ?? 'Couldn’t send the invitation.' })
      return
    }
    form.reset()
    announce(`Invitation sent to ${email}`)
    setMessage({ severity: 'success', text: `Invitation sent to ${email}.` })
    await onInvited()
  }

  return (
    <Box component="form" onSubmit={(e) => void submit(e)} noValidate>
      <Typography variant="h2" component="h2" sx={{ mb: 1.5 }}>
        Invite someone
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap>
        <TextField
          name="email"
          type="email"
          label="Email"
          required
          size="small"
          sx={{ flex: 1, maxWidth: 360 }}
        />
        <TextField
          name="role"
          label="Role"
          select
          defaultValue="member"
          size="small"
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="member">Member</MenuItem>
          <MenuItem value="admin">Admin</MenuItem>
        </TextField>
        <Button type="submit" variant="contained" disabled={busy}>
          {busy ? 'Sending…' : 'Send invitation'}
        </Button>
      </Stack>
      {message ? (
        <Alert severity={message.severity} sx={{ mt: 1.5, maxWidth: 560 }}>
          {message.text}
        </Alert>
      ) : null}
    </Box>
  )
}

export namespace InviteForm {
  export interface Props {
    organizationId: string
    onInvited: () => Promise<unknown>
  }
}

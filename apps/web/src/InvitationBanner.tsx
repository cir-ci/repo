import { Alert, Box, Button, Stack } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { authClient } from './auth.ts'

type Invitation = { id: string; organizationName: string; role: string; email: string }

/**
 * An invitation link (`/#invite=<id>`) opened while signed in: shows who invited you to what,
 * and joins on one click. Nothing happens from just opening the link, so mail scanners that
 * visit it can't accept on anyone's behalf (they have no session anyway).
 */
export function InvitationBanner({ userEmail }: { userEmail: string }) {
  const queryClient = useQueryClient()
  const [id] = useState(readInvitationId)
  const [invitation, setInvitation] = useState<Invitation | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [gone, setGone] = useState(id === undefined)

  useEffect(() => {
    if (!id) return
    void authClient.organization
      .getInvitation({ query: { id } })
      .then(({ data, error: failure }) => {
        if (failure || !data) {
          setError('This invitation is not for this account, has expired, or was withdrawn.')
          return
        }
        setInvitation({
          id,
          organizationName: data.organizationName,
          role: data.role,
          email: data.email,
        })
      })
  }, [id])

  if (gone || !id) return null

  function dismiss() {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setGone(true)
  }

  async function accept() {
    setBusy(true)
    setError(undefined)
    const { error: failure } = await authClient.organization.acceptInvitation({
      invitationId: id ?? '',
    })
    setBusy(false)
    if (failure) {
      setError('Couldn’t join. The invitation may have expired or been withdrawn.')
      return
    }
    await queryClient.invalidateQueries()
    dismiss()
  }

  return (
    <Box sx={{ px: { xs: 2, xl: 3 }, pt: 2 }}>
      <Alert
        severity={error ? 'error' : 'info'}
        action={
          <Stack direction="row" spacing={1}>
            {invitation && !error ? (
              <Button color="inherit" size="small" disabled={busy} onClick={() => void accept()}>
                Join
              </Button>
            ) : null}
            <Button color="inherit" size="small" onClick={dismiss}>
              Dismiss
            </Button>
          </Stack>
        }
      >
        {error ??
          (invitation
            ? invitation.email.toLowerCase() === userEmail.toLowerCase()
              ? `You’re invited to join ${invitation.organizationName} as ${invitation.role}.`
              : `This invitation is for ${invitation.email}, but you’re signed in as ${userEmail}. Sign out and use that address.`
            : 'Checking your invitation…')}
      </Alert>
    </Box>
  )
}

function readInvitationId(): string | undefined {
  return new URLSearchParams(window.location.hash.slice(1)).get('invite') ?? undefined
}

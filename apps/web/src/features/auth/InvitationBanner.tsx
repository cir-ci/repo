import { Banner, Button } from '@circi/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { authClient } from '#lib/auth-client.ts'
import { toast } from '#lib/toast.ts'

import styles from './InvitationBanner.module.css'

type Invitation = { id: string; workspaceName: string; role: string; email: string }

/**
 * An invitation link (`/#invite=<id>`) opened while signed in: shows who invited you to what,
 * and joins on one click. Nothing happens from just opening the link, so mail scanners that
 * visit it can't accept on anyone's behalf (they have no session anyway).
 */
export function InvitationBanner({ userEmail }: InvitationBanner.Props) {
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
          setError("This invitation isn't for this account, has expired, or was withdrawn.")
          return
        }
        setInvitation({
          id,
          workspaceName: data.organizationName,
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
      setError("Couldn't join. The invitation may have expired or been withdrawn.")
      toast.error("Couldn't join: the invitation may have expired or been withdrawn")
      return
    }
    toast(`Joined ${invitation?.workspaceName ?? 'the workspace'}`)
    await queryClient.invalidateQueries()
    dismiss()
  }

  return (
    <div className={styles.wrap}>
      <Banner
        tone={error ? 'danger' : 'info'}
        action={
          <div className={styles.actions}>
            {invitation && !error ? (
              <Button size="sm" variant="primary" loading={busy} onClick={() => void accept()}>
                Join
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Dismiss
            </Button>
          </div>
        }
      >
        {error ??
          (invitation
            ? invitation.email.toLowerCase() === userEmail.toLowerCase()
              ? `You're invited to join ${invitation.workspaceName} as ${invitation.role}.`
              : `This invitation is for ${invitation.email}, but you're signed in as ${userEmail}. Sign out and use that address.`
            : 'Checking your invitation…')}
      </Banner>
    </div>
  )
}

export namespace InvitationBanner {
  export interface Props {
    userEmail: string
  }
}

function readInvitationId(): string | undefined {
  return new URLSearchParams(window.location.hash.slice(1)).get('invite') ?? undefined
}

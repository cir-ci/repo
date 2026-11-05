import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { authClient } from '../auth.ts'
import { ErrorState, RelativeTime, useDocumentTitle } from '../components.tsx'
import { ListSkeleton, useAnnounce } from '../primitives/feedback.tsx'
import { PageHeader } from '../primitives/PageHeader.tsx'
import { PageLayout } from '../primitives/PageLayout.tsx'

/** Who is in an organization, and (for owners and admins) inviting people and removing them. */
export function MembersPage() {
  const { org } = useParams({ from: '/organizations/$org/members' })
  const { data: session } = authClient.useSession()
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  useDocumentTitle('Members', org)

  const key = ['organization', org] as const
  const { data, error, refetch } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data: full, error: failure } = await authClient.organization.getFullOrganization({
        query: { organizationSlug: org },
      })
      if (failure || !full) throw new Error('Organization not found')
      return full
    },
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: key })
  const cancel = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error: failure } = await authClient.organization.cancelInvitation({ invitationId })
      if (failure) throw new Error('Couldn’t withdraw the invitation')
    },
    onSuccess: () => {
      announce('Invitation withdrawn')
      return refresh()
    },
  })
  const remove = useMutation({
    mutationFn: async (memberId: string) => {
      const { error: failure } = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId: data?.id ?? '',
      })
      if (failure) throw new Error('Couldn’t remove this member')
    },
    onSuccess: () => {
      announce('Member removed')
      return refresh()
    },
  })

  const me = data?.members.find((m) => m.userId === session?.user.id)
  const canManage = me?.role === 'owner' || me?.role === 'admin'
  const pending = data?.invitations.filter((i) => i.status === 'pending') ?? []

  return (
    <PageLayout header={<PageHeader title={`${data?.name ?? org} members`} />}>
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          notFound="This organization doesn’t exist"
        />
      ) : !data ? (
        <ListSkeleton />
      ) : (
        <Stack spacing={4}>
          {canManage ? <InviteForm organizationId={data.id} onInvited={refresh} /> : null}
          {cancel.error || remove.error ? (
            <Alert severity="error">{(cancel.error ?? remove.error)?.message}</Alert>
          ) : null}
          <Section title="Members" count={data.members.length}>
            {data.members.map((m) => (
              <Row
                key={m.id}
                primary={m.user.name}
                secondary={`${m.user.email} · ${m.role}`}
                action={
                  canManage && m.userId !== session?.user.id ? (
                    <Button
                      color="error"
                      size="small"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(m.id)}
                    >
                      Remove
                    </Button>
                  ) : null
                }
              />
            ))}
          </Section>
          {pending.length > 0 ? (
            <Section title="Pending invitations" count={pending.length}>
              {pending.map((i) => (
                <Row
                  key={i.id}
                  primary={i.email}
                  secondary={
                    <>
                      {i.role} · expires <RelativeTime iso={new Date(i.expiresAt).toISOString()} />
                    </>
                  }
                  action={
                    canManage ? (
                      <Button
                        size="small"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(i.id)}
                      >
                        Withdraw
                      </Button>
                    ) : null
                  }
                />
              ))}
            </Section>
          ) : null}
        </Stack>
      )}
    </PageLayout>
  )
}

function InviteForm({
  organizationId,
  onInvited,
}: {
  organizationId: string
  onInvited: () => Promise<unknown>
}) {
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

function Section(props: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Box component="section">
      <Typography variant="h2" component="h2" sx={{ mb: 1.5 }}>
        {props.title} ({props.count})
      </Typography>
      <Box
        component="ul"
        sx={{ listStyle: 'none', m: 0, p: 0, border: 1, borderColor: 'divider', borderRadius: 1 }}
      >
        {props.children}
      </Box>
    </Box>
  )
}

function Row(props: {
  primary: React.ReactNode
  secondary: React.ReactNode
  action: React.ReactNode
}) {
  return (
    <Box
      component="li"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 2,
        py: 1.25,
        '&:not(:last-child)': { borderBottom: 1, borderColor: 'divider' },
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{props.primary}</Typography>
        <Typography variant="body2" color="text.secondary">
          {props.secondary}
        </Typography>
      </Box>
      {props.action}
    </Box>
  )
}

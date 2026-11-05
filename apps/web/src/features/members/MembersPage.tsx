import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { ErrorState, RelativeTime, useDocumentTitle } from '../../components.tsx'
import { authClient } from '../../lib/auth-client.ts'
import { ListSkeleton, useAnnounce } from '../../primitives/feedback.tsx'
import { PageHeader } from '../../primitives/PageHeader.tsx'
import { PageLayout } from '../../primitives/PageLayout.tsx'
import { Row, Section } from '../../primitives/Rows.tsx'
import { domainsQuery, orgAuthQuery, useDomainActions, useSaveOrgAuth } from './api.ts'

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
          {canManage ? <SignInMethods org={org} /> : null}
          {canManage ? <EmailDomains org={org} /> : null}
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

/** Which login methods this organization accepts; the server keeps at least one usable by an owner. */
function SignInMethods({ org }: { org: string }) {
  const { data } = useQuery(orgAuthQuery(org))
  const save = useSaveOrgAuth(org)
  if (!data) return null
  const { settings, instance } = data
  const toggle = (patch: Partial<typeof settings>) => save.mutate(patch)
  return (
    <Box component="section">
      <Typography variant="h2" component="h2" sx={{ mb: 0.5 }}>
        Sign-in methods
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1 }}>
        People sign in with any method the instance offers, but this organization only shows its
        projects to sessions that used a method you accept here.
      </Typography>
      <Stack>
        <FormControlLabel
          label="Password"
          control={
            <Checkbox
              checked={settings.passwordLoginEnabled && instance.password}
              disabled={!instance.password || save.isPending}
              onChange={(_, on) => toggle({ passwordLoginEnabled: on })}
            />
          }
        />
        <FormControlLabel
          label={instance.email ? 'Email code' : 'Email code (not set up on this instance)'}
          control={
            <Checkbox
              checked={settings.emailLoginEnabled && instance.email}
              disabled={!instance.email || save.isPending}
              onChange={(_, on) => toggle({ emailLoginEnabled: on })}
            />
          }
        />
      </Stack>
      {save.error ? (
        <Alert severity="error" sx={{ mt: 1, maxWidth: 560 }}>
          {save.error.message}
        </Alert>
      ) : null}
    </Box>
  )
}

/** Email domains this organization claims: people signing in with a code on one join as members. */
function EmailDomains({ org }: { org: string }) {
  const { data } = useQuery(domainsQuery(org))
  const { add, verify, remove } = useDomainActions(org)
  const [checked, setChecked] = useState<string | null>(null)
  const failure = add.error ?? verify.error ?? remove.error

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const raw = new FormData(form).get('domain')
    await add.mutateAsync(typeof raw === 'string' ? raw : '')
    form.reset()
  }

  return (
    <Box component="section">
      <Typography variant="h2" component="h2" sx={{ mb: 0.5 }}>
        Email domains
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1.5 }}>
        Once a domain is verified, anyone who signs in with an emailed code on an address at that
        domain joins this organization as a member, with no invitation.
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, mb: 1.5, p: 0 }}>
        {(data?.domains ?? []).map((d) => (
          <Box
            component="li"
            key={d.id}
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              p: 1.5,
              mb: 1,
              maxWidth: 640,
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography sx={{ fontWeight: 600, flex: 1 }}>{d.domain}</Typography>
              <Typography variant="body2" color={d.verified ? 'success.main' : 'text.secondary'}>
                {d.verified ? 'Verified' : 'Not verified'}
              </Typography>
              <Button size="small" color="error" onClick={() => remove.mutate(d.id)}>
                Remove
              </Button>
            </Stack>
            {d.verified ? null : (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  Add this DNS TXT record, then check:
                </Typography>
                <Box
                  component="code"
                  sx={{
                    display: 'block',
                    overflowWrap: 'anywhere',
                    fontFamily: 'monospace',
                    typography: 'body2',
                  }}
                >
                  {d.dnsName} TXT {d.dnsValue}
                </Box>
                <Button
                  size="small"
                  sx={{ mt: 1 }}
                  disabled={verify.isPending}
                  onClick={() =>
                    verify.mutate(d.id, { onSuccess: (r) => setChecked(r.verified ? null : d.id) })
                  }
                >
                  Check now
                </Button>
                {checked === d.id ? (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    component="span"
                    sx={{ ml: 1 }}
                  >
                    Not found yet. DNS can take a few minutes to spread.
                  </Typography>
                ) : null}
              </Box>
            )}
          </Box>
        ))}
      </Box>
      <Box component="form" onSubmit={(e) => void submit(e)} noValidate>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap>
          <TextField
            name="domain"
            label="Domain"
            placeholder="example.com"
            size="small"
            required
            sx={{ maxWidth: 280 }}
          />
          <Button type="submit" variant="outlined" disabled={add.isPending}>
            Add domain
          </Button>
        </Stack>
      </Box>
      {failure ? (
        <Alert severity="error" sx={{ mt: 1, maxWidth: 560 }}>
          {failure.message}
        </Alert>
      ) : null}
    </Box>
  )
}

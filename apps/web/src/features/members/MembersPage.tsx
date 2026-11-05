import { Alert, Button, Stack } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { ErrorState, RelativeTime, useDocumentTitle } from '../../components.tsx'
import { authClient } from '../../lib/auth-client.ts'
import { ListSkeleton, useAnnounce } from '../../primitives/feedback.tsx'
import { PageHeader } from '../../primitives/PageHeader.tsx'
import { PageLayout } from '../../primitives/PageLayout.tsx'
import { Row, Section } from '../../primitives/Rows.tsx'
import { EmailDomains } from './EmailDomains.tsx'
import { InviteForm } from './InviteForm.tsx'
import { OrgSso } from './OrgSso.tsx'
import { SignInMethods } from './SignInMethods.tsx'

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
          {canManage ? <OrgSso org={org} /> : null}
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

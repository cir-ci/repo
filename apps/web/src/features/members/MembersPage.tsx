import {
  Avatar,
  Banner,
  Breadcrumbs,
  Button,
  ConfirmDialog,
  Delayed,
  EmptyState,
  IconButton,
  ListRow,
  ListSkeleton,
  Menu,
  PanelHeader,
  RowMenuIcon,
  SectionHeader,
  Select,
  Text,
  useAnnounce,
} from '@circi/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { authClient } from '../../lib/auth-client.ts'
import { useDocumentTitle } from '../../lib/document-title.ts'
import { ErrorState } from '../../lib/ErrorState.tsx'
import { RelativeTime } from '../../lib/RelativeTime.tsx'
import { cancelInvitation, changeMemberRole, organizationQuery, removeMember } from './api.ts'
import { EmailDomains } from './EmailDomains.tsx'
import { InviteForm } from './InviteForm.tsx'
import { canManageMembers, invitationCount, peopleCount, pendingInvitations } from './model.ts'
import { OrgSso } from './OrgSso.tsx'
import { SignInMethods } from './SignInMethods.tsx'

import styles from './MembersPage.module.css'

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
]

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

/** Who is in an organization, and (for owners and admins) inviting people and removing them. */
export function MembersPage() {
  const { org } = useParams({ from: '/organizations/$org/members' })
  const { data: session } = authClient.useSession()
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  useDocumentTitle('Members', org)

  const query = organizationQuery(org)
  const { data, error, refetch } = useQuery(query)
  const [removing, setRemoving] = useState<{ id: string; name: string; email: string } | null>(null)

  useEffect(() => {
    if (!data && !error) announce('Loading members')
  }, [data, error, announce])

  const refresh = () => queryClient.invalidateQueries({ queryKey: query.queryKey })
  const cancel = useMutation({
    mutationFn: cancelInvitation,
    onSuccess: () => {
      announce('Invitation withdrawn')
      return refresh()
    },
  })
  const remove = useMutation({
    mutationFn: removeMember,
    onSuccess: () => {
      announce('Member removed')
      setRemoving(null)
      return refresh()
    },
    onError: () => setRemoving(null),
  })
  const changeRole = useMutation({
    mutationFn: changeMemberRole,
    onSuccess: (_, { memberId, role }) => {
      const member = data?.members.find((m) => m.id === memberId)
      announce(`${member?.user.name ?? 'Member'} is now ${ROLE_LABEL[role] ?? role}`)
      return refresh()
    },
  })

  const canManage = canManageMembers(data?.members ?? [], session?.user.id)
  const pending = pendingInvitations(data?.invitations ?? [])
  const failure = cancel.error ?? remove.error ?? changeRole.error

  return (
    <>
      <PanelHeader>
        <Breadcrumbs items={[{ label: data?.name ?? org }, { label: 'Members' }]} />
      </PanelHeader>
      <div className={styles['page']}>
        {error ? (
          <ErrorState
            error={error}
            onRetry={() => void refetch()}
            notFound="This organization doesn’t exist"
          />
        ) : !data ? (
          <Delayed>
            <ListSkeleton />
          </Delayed>
        ) : (
          <>
            {canManage ? <InviteForm organizationId={data.id} onInvited={refresh} /> : null}
            {failure ? <Banner tone="danger">{failure.message}</Banner> : null}
            <section className={styles['section']}>
              <SectionHeader title="Members" description={peopleCount(data.members.length)} />
              <div className={styles['list']}>
                {data.members.map((m) => {
                  const isMe = m.userId === session?.user.id
                  const editable = canManage && !isMe
                  return (
                    <ListRow key={m.id} leading={<Avatar name={m.user.name} />}>
                      <div className={styles['member']}>
                        <div className={styles['who']}>
                          <Text truncate>{m.user.name}</Text>
                          <Text variant="small" tone="secondary" truncate>
                            {m.user.email}
                          </Text>
                        </div>
                        <div
                          className={styles['controls']}
                          data-editable={editable ? '' : undefined}
                        >
                          {editable && m.role !== 'owner' ? (
                            <Select
                              className={styles['role']}
                              label={`Role of ${m.user.name}`}
                              hideLabel
                              items={ROLES}
                              value={m.role}
                              disabled={changeRole.isPending}
                              onValueChange={(role) => {
                                if (role !== m.role) {
                                  changeRole.mutate({
                                    memberId: m.id,
                                    role: role === 'admin' ? 'admin' : 'member',
                                    organizationId: data.id,
                                  })
                                }
                              }}
                            />
                          ) : (
                            <Text variant="small" tone="secondary">
                              {ROLE_LABEL[m.role] ?? m.role}
                            </Text>
                          )}
                          {editable ? (
                            <Menu
                              align="end"
                              trigger={
                                <IconButton label={`Actions for ${m.user.name}`}>
                                  <RowMenuIcon />
                                </IconButton>
                              }
                              items={[
                                {
                                  label: 'Remove from organization',
                                  tone: 'danger',
                                  onSelect: () =>
                                    setRemoving({
                                      id: m.id,
                                      name: m.user.name,
                                      email: m.user.email,
                                    }),
                                },
                              ]}
                            />
                          ) : null}
                        </div>
                      </div>
                    </ListRow>
                  )
                })}
              </div>
              {canManage && data.members.length === 1 ? (
                <EmptyState title="No one else is here yet">
                  Invite a teammate above, or let a verified email domain add people.
                </EmptyState>
              ) : null}
            </section>
            {canManage ? <SignInMethods org={org} /> : null}
            {canManage ? <EmailDomains org={org} /> : null}
            {canManage ? <OrgSso org={org} /> : null}
            {pending.length > 0 ? (
              <section className={styles['section']}>
                <SectionHeader
                  title="Pending invitations"
                  description={invitationCount(pending.length)}
                />
                <div className={styles['list']}>
                  {pending.map((i) => (
                    <ListRow
                      key={i.id}
                      trailing={
                        canManage ? (
                          <Button
                            size="sm"
                            loading={cancel.isPending && cancel.variables === i.id}
                            disabled={cancel.isPending}
                            onClick={() => cancel.mutate(i.id)}
                          >
                            Withdraw
                          </Button>
                        ) : null
                      }
                    >
                      <div className={styles['who']}>
                        <Text truncate>{i.email}</Text>
                        <Text variant="small" tone="secondary">
                          {ROLE_LABEL[i.role ?? 'member'] ?? i.role} · expires{' '}
                          <RelativeTime iso={new Date(i.expiresAt).toISOString()} />
                        </Text>
                      </div>
                    </ListRow>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={`Remove ${removing?.name ?? 'this member'}?`}
        description={`${removing?.email ?? 'They'} will lose access to ${data?.name ?? org} and its projects. You can invite them again later.`}
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => {
          if (removing && data) remove.mutate({ memberId: removing.id, organizationId: data.id })
        }}
      />
    </>
  )
}

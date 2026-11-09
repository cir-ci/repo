import {
  Avatar,
  Badge,
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  ListRow,
  Menu,
  RowMenuIcon,
  Select,
  SettingsPage,
  SettingsSection,
  Text,
  useAnnounce,
} from '@circi/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { authClient } from '#lib/auth-client.ts'
import { workspaceSettingsCrumb } from '#lib/crumbs.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import {
  cancelInvitation,
  changeMemberRole,
  inviteMember,
  memberSignInQuery,
  removeMember,
  workspaceQuery,
} from './api.ts'
import { InviteForm } from './InviteForm.tsx'
import {
  canManageMembers,
  invitationCount,
  peopleCount,
  pendingInvitations,
  signInTags,
} from './model.ts'

import styles from './MembersPage.module.css'

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
]

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

/** Who is in a workspace, and (for owners and admins) inviting people and removing them. */
export function MembersPage() {
  const { workspace } = useParams({ from: '/workspaces/$workspace/settings/members' })
  const { data: session } = authClient.useSession()
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  useDocumentTitle('Members', workspace)

  const query = workspaceQuery(workspace)
  const result = useQuery(query)
  const { data } = result
  const [removing, setRemoving] = useState<{ id: string; name: string; email: string } | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: query.queryKey })
  const cancel = useMutation({
    mutationFn: cancelInvitation,
    onSuccess: () => {
      announce('Invitation revoked')
      return refresh()
    },
  })
  const resend = useMutation({
    mutationFn: inviteMember,
    onSuccess: (_, { email }) => {
      announce(`Invitation sent again to ${email}`)
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
  // Only owners and admins may see how people sign in; the tags are left out while loading or on error.
  const signIn = useQuery({ ...memberSignInQuery(workspace), enabled: canManage })
  const methodsOf = new Map((signIn.data?.members ?? []).map((m) => [m.userId, m.methods]))
  const pending = pendingInvitations(data?.invitations ?? [])
  const failure = cancel.error ?? resend.error ?? remove.error ?? changeRole.error

  return (
    <>
      <PageHeading
        crumbs={crumbsFor({ workspace: { slug: workspace, name: data?.name ?? workspace } }, [
          workspaceSettingsCrumb(workspace),
        ])}
        title="Members"
      />
      <SettingsPage>
        <QueryBoundary
          query={result}
          announce="Loading members"
          notFound="This workspace doesn’t exist"
        >
          {(loaded) => (
            <>
              {canManage ? (
                <InviteForm workspaceId={loaded.id} onInvited={refresh} />
              ) : (
                <Banner>
                  Only owners and admins can invite people, change roles or remove people.
                </Banner>
              )}
              {failure ? <Banner tone="danger">{failure.message}</Banner> : null}
              <SettingsSection
                title="Members"
                description={peopleCount(loaded.members.length)}
                bare
              >
                <div className={styles.list}>
                  {loaded.members.map((m) => {
                    const isMe = m.userId === session?.user.id
                    const editable = canManage && !isMe
                    return (
                      <ListRow key={m.id} leading={<Avatar name={m.user.name} />}>
                        <div className={styles.member}>
                          <div className={styles.who}>
                            <span className={styles.nameLine}>
                              <Text truncate>{m.user.name}</Text>
                              {isMe ? <Text tone="tertiary">· you</Text> : null}
                            </span>
                            <Text variant="small" tone="secondary" truncate>
                              {m.user.email}
                            </Text>
                            {signInTags(methodsOf.get(m.userId) ?? []).length > 0 ? (
                              <ul
                                className={styles.tags}
                                aria-label={`How ${m.user.name} signs in`}
                              >
                                {signInTags(methodsOf.get(m.userId) ?? []).map((tag) => (
                                  <li key={tag}>
                                    <Badge shape="tag">{tag}</Badge>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                          <div
                            className={styles.controls}
                            data-editable={editable ? '' : undefined}
                          >
                            {editable && m.role !== 'owner' ? (
                              <Select
                                className={styles.role}
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
                                      workspaceId: loaded.id,
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
                                    label: 'Remove from workspace',
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
                {canManage && loaded.members.length === 1 ? (
                  <EmptyState title="No one else is here yet">
                    Invite a teammate above, or let a verified email domain add people.
                  </EmptyState>
                ) : null}
              </SettingsSection>
              {pending.length > 0 ? (
                <SettingsSection
                  title="Pending invitations"
                  description={invitationCount(pending.length)}
                  bare
                >
                  <div className={styles.list}>
                    {pending.map((i) => (
                      <ListRow
                        key={i.id}
                        trailing={
                          canManage ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={resend.isPending && resend.variables?.email === i.email}
                                disabled={resend.isPending || cancel.isPending}
                                onClick={() =>
                                  resend.mutate({
                                    email: i.email,
                                    role: i.role === 'admin' ? 'admin' : 'member',
                                    workspaceId: loaded.id,
                                    resend: true,
                                  })
                                }
                              >
                                Resend
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={cancel.isPending && cancel.variables === i.id}
                                disabled={cancel.isPending || resend.isPending}
                                onClick={() => cancel.mutate(i.id)}
                              >
                                Revoke
                              </Button>
                            </>
                          ) : null
                        }
                      >
                        <div className={styles.who}>
                          <Text truncate>{i.email}</Text>
                          <Text variant="small" tone="secondary">
                            {ROLE_LABEL[i.role ?? 'member'] ?? i.role} · expires{' '}
                            <RelativeTime iso={new Date(i.expiresAt).toISOString()} />
                          </Text>
                        </div>
                      </ListRow>
                    ))}
                  </div>
                </SettingsSection>
              ) : null}
              <Text variant="small" tone="tertiary">
                Sign-in methods and email domains are in{' '}
                <Link to="/workspaces/$workspace/settings/sign-in" params={{ workspace }}>
                  Sign-in and domains
                </Link>
                .
              </Text>
            </>
          )}
        </QueryBoundary>
      </SettingsPage>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={`Remove ${removing?.name ?? 'this member'}?`}
        description={`${removing?.email ?? 'They'} will lose access to ${data?.name ?? workspace} and its teams. You can invite them again later.`}
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => {
          if (removing && data) remove.mutate({ memberId: removing.id, workspaceId: data.id })
        }}
      />
    </>
  )
}

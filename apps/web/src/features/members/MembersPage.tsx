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
  NoResults,
  PlusIcon,
  RowMenuIcon,
  Select,
  SettingsPage,
  SettingsSection,
  Text,
  UsersIcon,
} from '@circi/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { memberProjectsQuery } from '#features/projects/api/members.ts'
import { Projectstack } from '#features/projects/AvatarStack.tsx'
import { WorkspaceBackLink } from '#features/workspace-settings/WorkspaceBackLink.tsx'
import { authClient } from '#lib/auth-client.ts'
import { workspaceSettingsCrumb } from '#lib/crumbs.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { findIn, useFindParam } from '#lib/find.ts'
import { FindField } from '#lib/FindField.tsx'
import { settingsCrumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { toast } from '#lib/toast.ts'

import {
  type AssignableRole,
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
  useDocumentTitle('Members', workspace)

  const query = workspaceQuery(workspace)
  const result = useQuery(query)
  const { data } = result
  const [find, setFind] = useFindParam()
  const [inviting, setInviting] = useState(false)
  const shownMembers = findIn(data?.members ?? [], find, (m) => [
    m.user.name,
    m.user.email,
    ROLE_LABEL[m.role] ?? m.role,
  ])
  const [roleChange, setRoleChange] = useState<{
    memberId: string
    name: string
    role: AssignableRole
  } | null>(null)
  const [removing, setRemoving] = useState<{ id: string; name: string; email: string } | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: query.queryKey })
  const cancel = useMutation({
    meta: { what: 'revoke the invitation' },
    mutationFn: cancelInvitation,
    onSuccess: () => {
      toast('Invitation revoked')
      return refresh()
    },
  })
  const resend = useMutation({
    meta: { what: 'resend the invitation' },
    mutationFn: inviteMember,
    onSuccess: (_, { email }) => {
      toast(`Invitation sent again to ${email}`)
      return refresh()
    },
  })
  const remove = useMutation({
    meta: { what: 'remove the member' },
    mutationFn: removeMember,
    onSuccess: () => {
      toast('Member removed')
      setRemoving(null)
      return refresh()
    },
    onError: () => setRemoving(null),
  })
  const changeRole = useMutation({
    meta: { what: 'change the role' },
    mutationFn: changeMemberRole,
    onSuccess: (_, { memberId, role }) => {
      const member = data?.members.find((m) => m.id === memberId)
      toast(`${member?.user.name ?? 'Member'} is now ${ROLE_LABEL[role] ?? role}`)
      return refresh()
    },
  })

  const canManage = canManageMembers(data?.members ?? [], session?.user.id)
  // Only owners and admins may see how people sign in; the tags are left out while loading or on error.
  const signIn = useQuery({ ...memberSignInQuery(workspace), enabled: canManage })
  const methodsOf = new Map((signIn.data?.members ?? []).map((m) => [m.userId, m.methods]))
  // The projects each person is in, beside their role.
  const memberProjects = useQuery(memberProjectsQuery(workspace))
  const pending = pendingInvitations(data?.invitations ?? [])
  const failure = cancel.error ?? resend.error ?? remove.error ?? changeRole.error

  return (
    <>
      <PageHeading
        crumbs={settingsCrumbsFor({ slug: workspace, name: data?.name ?? workspace }, [
          workspaceSettingsCrumb(workspace),
        ])}
        title="Members"
        find={<FindField noun="members" value={find} onChange={setFind} />}
        actions={
          canManage ? (
            <Button
              variant="primary"
              leading={<PlusIcon size={14} />}
              onClick={() => setInviting(true)}
            >
              Invite
            </Button>
          ) : undefined
        }
      />
      <SettingsPage>
        <QueryBoundary
          query={result}
          announce="Loading members"
          notFound="This workspace doesn't exist"
        >
          {(loaded) => (
            <>
              <WorkspaceBackLink workspace={workspace} name={loaded.name} />
              {canManage ? (
                <InviteForm
                  workspaceId={loaded.id}
                  open={inviting}
                  onClose={() => setInviting(false)}
                  onInvited={refresh}
                />
              ) : null}
              {failure ? <Banner tone="danger">{failure.message}</Banner> : null}
              <SettingsSection
                title="Members"
                description={peopleCount(loaded.members.length)}
                bare
              >
                {shownMembers.length === 0 ? (
                  <NoResults
                    noun="member"
                    query={find}
                    onClear={() => setFind('')}
                    size="section"
                  />
                ) : null}
                <div className={styles.list}>
                  {shownMembers.map((m) => {
                    const isMe = m.userId === session?.user.id
                    const editable = canManage && !isMe
                    return (
                      <ListRow
                        key={m.id}
                        leading={
                          <Avatar
                            type="user"
                            id={m.user.id}
                            name={m.user.name}
                            image={m.user.image ?? null}
                          />
                        }
                      >
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
                          <div className={styles.controls}>
                            {memberProjects.data ? (
                              <div className={styles.projects}>
                                <Projectstack
                                  projects={memberProjects.data.projects[m.userId] ?? []}
                                />
                              </div>
                            ) : null}
                            <div className={styles.actions}>
                              {editable && m.role !== 'owner' ? (
                                <Select
                                  className={styles.role}
                                  label={`Role of ${m.user.name}`}
                                  hideLabel
                                  items={ROLES}
                                  value={m.role}
                                  disabled={changeRole.isPending}
                                  onValueChange={(role) => {
                                    // A role decides what the person can change: ask before applying it.
                                    if (role !== m.role) {
                                      setRoleChange({
                                        memberId: m.id,
                                        name: m.user.name,
                                        role: role === 'admin' ? 'admin' : 'member',
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
                        </div>
                      </ListRow>
                    )
                  })}
                </div>
                {canManage && loaded.members.length === 1 ? (
                  <EmptyState icon={<UsersIcon />} size="section" title="No one else is here yet">
                    Invite a teammate, or let a verified email domain add people.
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
              {resend.isSuccess ? (
                <Banner tone="success">Invitation sent again to {resend.variables.email}.</Banner>
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
        open={roleChange !== null}
        onOpenChange={(open) => {
          if (!open) setRoleChange(null)
        }}
        title={`Make ${roleChange?.name ?? 'this member'} ${roleChange?.role === 'admin' ? 'an admin' : 'a member'}?`}
        description={
          roleChange?.role === 'admin'
            ? "Admins can invite and remove people, change roles and change every project's settings."
            : 'They will no longer be able to invite or remove people, or change settings.'
        }
        confirmLabel="Change role"
        loading={changeRole.isPending}
        onConfirm={() => {
          if (!roleChange || !data) return
          changeRole.mutate(
            { memberId: roleChange.memberId, role: roleChange.role, workspaceId: data.id },
            { onSettled: () => setRoleChange(null) },
          )
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={`Remove ${removing?.name ?? 'this member'}?`}
        description={`${removing?.email ?? 'They'} will lose access to ${data?.name ?? workspace} and its projects. You can invite them again later.`}
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => {
          if (removing && data) remove.mutate({ memberId: removing.id, workspaceId: data.id })
        }}
      />
    </>
  )
}

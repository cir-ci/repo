import type { Team } from '@circi/api'
import {
  Avatar,
  Banner,
  Button,
  Checkbox,
  ConfirmDialog,
  FormDialog,
  PlusIcon,
  Text,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { workspaceQuery } from '#features/members/api.ts'
import {
  teamMembersQuery,
  useAddTeamMembers,
  useRemoveTeamMember,
} from '#features/teams/api/members.ts'
import { authClient } from '#lib/auth-client.ts'
import { findIn, useFindParam } from '#lib/find.ts'
import { FindField, NoMatches } from '#lib/FindField.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'

import { addCandidates, addLabel, removalText, ROLE_LABEL } from './members-model.ts'
import { TeamSettingsFrame } from './TeamSettingsFrame.tsx'

import styles from './TeamMembersPage.module.css'

/**
 * A team's Members tab (the canvas's TeamMembers boards): everyone in the team with their
 * workspace role. Owners and admins add workspace members and remove people; everyone can leave.
 * Each change is a one-off action confirmed in its own dialog, so none of it waits for a Save.
 */
export function TeamMembersPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team/settings/members' })
  return (
    <TeamSettingsFrame workspace={workspace} team={team} page="Members" managersOnly={false}>
      {(_settings, teamName) => <Members workspace={workspace} team={team} teamName={teamName} />}
    </TeamSettingsFrame>
  )
}

function Members({ workspace, team, teamName }: Members.Props) {
  const query = useQuery(teamMembersQuery(workspace, team))
  const { data: session } = authClient.useSession()
  const me = session?.user.id
  const announce = useAnnounce()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [find, setFind] = useFindParam()
  const [removing, setRemoving] = useState<Team.Member | null>(null)
  const remove = useRemoveTeamMember(workspace, team)

  const shown = (list: Team.Member[]) =>
    findIn(list, find, (m) => [m.name, m.email, ROLE_LABEL[m.role] ?? m.role])
  const leaving = removing !== null && removing.id === me
  const dialog = removing ? removalText(teamName, { name: removing.name, you: leaving }) : null

  return (
    <QueryBoundary query={query} announce="Loading members" rows={3}>
      {({ members, canManage }) => (
        <section className={styles.root} aria-labelledby="team-members">
          <div className={styles.head}>
            <h2 id="team-members" className={styles.title}>
              Members
            </h2>
            <FindField noun="members" value={find} onChange={setFind} />
            {canManage ? (
              <Button variant="primary" onClick={() => setAdding(true)}>
                <PlusIcon size={14} />
                Add members
              </Button>
            ) : null}
          </div>
          {remove.error ? <Banner tone="danger">{remove.error.message}</Banner> : null}
          {shown(members).length === 0 ? <NoMatches noun="members" query={find} /> : null}
          <ul aria-label="Team members" className={styles.list}>
            {shown(members).map((m) => {
              const you = m.id === me
              return (
                <li key={m.id} className={styles.row}>
                  <Avatar type="user" id={m.id} name={m.name} image={m.image} size={28} />
                  <span className={styles.who}>
                    <span className={styles.nameLine}>
                      <Text truncate>{m.name}</Text>
                      {you ? <Text tone="tertiary">· you</Text> : null}
                    </span>
                    <Text variant="small" tone="tertiary" truncate>
                      {m.email}
                    </Text>
                  </span>
                  <Text variant="small" tone="secondary" className={styles.role}>
                    {ROLE_LABEL[m.role] ?? m.role}
                  </Text>
                  {you || canManage ? (
                    <Button
                      variant="ghost"
                      aria-haspopup="dialog"
                      aria-label={you ? 'Leave team' : `Remove ${m.name} from team`}
                      onClick={() => setRemoving(m)}
                    >
                      {you ? 'Leave team' : 'Remove from team'}
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <AddMembersDialog
            open={adding}
            onClose={() => setAdding(false)}
            workspace={workspace}
            team={team}
            teamName={teamName}
            members={members}
          />
          <ConfirmDialog
            open={removing !== null}
            onOpenChange={(open) => {
              if (!open) setRemoving(null)
            }}
            title={dialog?.title ?? ''}
            description={dialog?.text}
            confirmLabel={dialog?.button ?? 'Remove'}
            loading={remove.isPending}
            onConfirm={() => {
              if (!removing) return
              remove.mutate(removing.id, {
                onSuccess: () => {
                  announce(
                    leaving
                      ? `You left ${teamName}`
                      : `${removing.name} was removed from ${teamName}`,
                  )
                  setRemoving(null)
                  // Someone who left may no longer see the team: go to the list of teams.
                  if (leaving)
                    void navigate({
                      to: '/workspaces/$workspace/settings/teams',
                      params: { workspace },
                    })
                },
                onError: () => setRemoving(null),
              })
            }}
          />
        </section>
      )}
    </QueryBoundary>
  )
}

/** "Add members to web-app": a search over the workspace members not in the team yet, and a checkbox each. */
function AddMembersDialog({
  open,
  onClose,
  workspace,
  team,
  teamName,
  members,
}: AddMembersDialog.Props) {
  const workspaceInfo = useQuery({ ...workspaceQuery(workspace), enabled: open })
  const add = useAddTeamMembers(workspace, team)
  const announce = useAnnounce()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const candidates = addCandidates(workspaceInfo.data?.members ?? [], members, query)

  function close() {
    setQuery('')
    setPicked([])
    add.reset()
    onClose()
  }

  return (
    <FormDialog
      open={open}
      onClose={close}
      onSubmit={() =>
        add.mutate(picked, {
          onSuccess: () => {
            announce(
              `Added ${picked.length === 1 ? '1 member' : `${picked.length} members`} to ${teamName}`,
            )
            close()
          },
        })
      }
      title={`Add members to ${teamName}`}
      size="wide"
      submitLabel={addLabel(picked.length)}
      submitDisabled={picked.length === 0}
      cancelVariant="ghost"
      pending={add.isPending}
      noValidate
      formClassName={styles.dialog}
    >
      <TextField
        label="Find a workspace member"
        hideLabel
        placeholder="Find a workspace member"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul aria-label={`Workspace members not in ${teamName}`} className={styles.candidates}>
        {candidates.map((m) => (
          <li key={m.userId}>
            <Checkbox
              className={styles.candidate}
              checked={picked.includes(m.userId)}
              onCheckedChange={(on) =>
                setPicked(on ? [...picked, m.userId] : picked.filter((id) => id !== m.userId))
              }
              label={
                <>
                  <Avatar
                    type="user"
                    aria-hidden
                    id={m.userId}
                    name={m.user.name}
                    image={m.user.image ?? null}
                    size={28}
                  />
                  <span className={styles.who}>
                    <Text>{m.user.name}</Text>
                    <Text variant="small" tone="tertiary">
                      {m.user.email}
                    </Text>
                  </span>
                  <Text variant="small" tone="secondary">
                    {ROLE_LABEL[m.role] ?? m.role}
                  </Text>
                </>
              }
            />
          </li>
        ))}
      </ul>
      {workspaceInfo.data && candidates.length === 0 ? (
        <Text variant="small" tone="tertiary">
          {query.trim()
            ? `No workspace member matches “${query.trim()}”.`
            : `Everyone in the workspace is in ${teamName}.`}
        </Text>
      ) : null}
      {add.error ? <Banner tone="danger">{add.error.message}</Banner> : null}
    </FormDialog>
  )
}

namespace Members {
  export interface Props {
    workspace: string
    team: string
    teamName: string
  }
}

namespace AddMembersDialog {
  export interface Props {
    open: boolean
    onClose: () => void
    workspace: string
    team: string
    teamName: string
    /** Who is in the team already. */
    members: ReadonlyArray<Team.Member>
  }
}

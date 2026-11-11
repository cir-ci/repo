import type { Project } from '@circi/api'
import {
  Avatar,
  Banner,
  Button,
  Checkbox,
  ConfirmDialog,
  FormDialog,
  NoResults,
  PlusIcon,
  Text,
  TextField,
} from '@circi/ui'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { workspaceQuery } from '#features/members/api.ts'
import {
  projectMembersQuery,
  useAddProjectMembers,
  useRemoveProjectMember,
} from '#features/projects/api/members.ts'
import { authClient } from '#lib/auth-client.ts'
import { findIn, useFindParam } from '#lib/find.ts'
import { FindField } from '#lib/FindField.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { toast } from '#lib/toast.ts'

import { addCandidates, addLabel, removalText, ROLE_LABEL } from './members-model.ts'
import { ProjectsettingsFrame } from './ProjectsettingsFrame.tsx'

import styles from './ProjectMembersPage.module.css'

/**
 * A project's Members page (the canvas's ProjectMembers boards): everyone in the project with their
 * workspace role. Owners and admins add workspace members and remove people; everyone can leave.
 * Each change is a one-off action confirmed in its own dialog, so none of it waits for a Save.
 */
export function ProjectMembersPage() {
  const { workspace, project } = useParams({ from: '/$workspace/$project/settings/members' })
  // The find field and the Add members button are the page header's; the list below shares their state.
  const query = useQuery(projectMembersQuery(workspace, project))
  const [adding, setAdding] = useState(false)
  const [find, setFind] = useFindParam()
  return (
    <ProjectsettingsFrame
      workspace={workspace}
      project={project}
      page="Members"
      managersOnly={false}
      find={<FindField noun="members" value={find} onChange={setFind} />}
      actions={
        query.data?.canManage ? (
          <Button
            variant="primary"
            leading={<PlusIcon size={14} />}
            onClick={() => setAdding(true)}
          >
            Add members
          </Button>
        ) : undefined
      }
    >
      {(_settings, projectName) => (
        <Members
          workspace={workspace}
          project={project}
          projectName={projectName}
          query={query}
          find={find}
          onFind={setFind}
          adding={adding}
          onAdding={setAdding}
        />
      )}
    </ProjectsettingsFrame>
  )
}

function Members({
  workspace,
  project,
  projectName,
  query,
  find,
  onFind: setFind,
  adding,
  onAdding: setAdding,
}: Members.Props) {
  const { data: session } = authClient.useSession()
  const me = session?.user.id
  const navigate = useNavigate()
  const [removing, setRemoving] = useState<Project.Member | null>(null)
  const remove = useRemoveProjectMember(workspace, project)

  const shown = (list: Project.Member[]) =>
    findIn(list, find, (m) => [m.name, m.email, ROLE_LABEL[m.role] ?? m.role])
  const leaving = removing !== null && removing.id === me
  const dialog = removing ? removalText(projectName, { name: removing.name, you: leaving }) : null

  return (
    <QueryBoundary query={query} announce="Loading members" rows={3}>
      {({ members, canManage }) => (
        <section className={styles.root} aria-labelledby="project-members">
          <div className={styles.head}>
            <h2 id="project-members" className={styles.title}>
              Members
            </h2>
          </div>
          {remove.error ? <Banner tone="danger">{remove.error.message}</Banner> : null}
          {shown(members).length === 0 ? (
            <NoResults noun="member" query={find} onClear={() => setFind('')} size="section" />
          ) : null}
          <ul aria-label="Project members" className={styles.list}>
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
                      aria-label={you ? 'Leave project' : `Remove ${m.name} from project`}
                      onClick={() => setRemoving(m)}
                    >
                      {you ? 'Leave project' : 'Remove from project'}
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
            project={project}
            projectName={projectName}
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
                  toast(
                    leaving
                      ? `You left ${projectName}`
                      : `${removing.name} was removed from ${projectName}`,
                  )
                  setRemoving(null)
                  // Someone who left may no longer see the project: go to the list of projects.
                  if (leaving)
                    void navigate({
                      to: '/workspaces/$workspace/settings/projects',
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

/** "Add members to web-app": a search over the workspace members not in the project yet, and a checkbox each. */
function AddMembersDialog({
  open,
  onClose,
  workspace,
  project,
  projectName,
  members,
}: AddMembersDialog.Props) {
  const workspaceInfo = useQuery({ ...workspaceQuery(workspace), enabled: open })
  const add = useAddProjectMembers(workspace, project)
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
            toast(
              `Added ${picked.length === 1 ? '1 member' : `${picked.length} members`} to ${projectName}`,
            )
            close()
          },
        })
      }
      title={`Add members to ${projectName}`}
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
      <ul aria-label={`Workspace members not in ${projectName}`} className={styles.candidates}>
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
            : `Everyone in the workspace is in ${projectName}.`}
        </Text>
      ) : null}
      {add.error ? <Banner tone="danger">{add.error.message}</Banner> : null}
    </FormDialog>
  )
}

namespace Members {
  export interface Props {
    workspace: string
    project: string
    projectName: string
    query: UseQueryResult<Project.MemberList>
    find: string
    onFind: (next: string) => void
    adding: boolean
    onAdding: (next: boolean) => void
  }
}

namespace AddMembersDialog {
  export interface Props {
    open: boolean
    onClose: () => void
    workspace: string
    project: string
    projectName: string
    /** Who is in the project already. */
    members: ReadonlyArray<Project.Member>
  }
}

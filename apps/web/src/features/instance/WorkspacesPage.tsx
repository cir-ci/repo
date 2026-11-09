import type { InstanceAdmin } from '@circi/api'
import {
  AddCircleIcon,
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  SettingsRow,
  SettingsSection,
  Text,
  TextField,
  visuallyHidden,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import { formatBytes } from '#features/workspace-settings/api.ts'
import { useDocumentTitle } from '#lib/document-title.ts'

import { AdminFrame, Intro } from './AdminFrame.tsx'
import {
  deletedLabel,
  formatDay,
  settingsQuery,
  slugPreview,
  useCreateWorkspace,
  usePurgeWorkspace,
  useRestoreWorkspace,
  type WorkspaceDraft,
  WORKSPACE_CREATION_TEXT,
  workspacesQuery,
  workspaceProblems,
} from './api/admin.ts'

import styles from './Admin.module.css'
import rows from './WorkspacesPage.module.css'

const emptyDraft = (): WorkspaceDraft => ({ name: '', ownerEmail: '' })

/** Every workspace of the instance, with its size, and creating one for an existing account. */
export function WorkspacesPage() {
  useDocumentTitle('Workspaces', 'Instance')
  const { data, error, refetch } = useQuery(workspacesQuery())
  // Who may create workspaces is a setting from the environment; the page works without it.
  const settings = useQuery(settingsQuery())
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const restore = useRestoreWorkspace()
  const purge = usePurgeWorkspace()
  const [purging, setPurging] = useState<InstanceAdmin.Workspace | null>(null)

  return (
    <AdminFrame
      title="Workspaces"
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
    >
      <Intro
        action={
          <Button
            variant="primary"
            leading={<AddCircleIcon />}
            onClick={() => {
              setCreated(null)
              setCreating(true)
            }}
          >
            Create workspace
          </Button>
        }
      >
        Every workspace on this CirCI. Their teams and builds stay private to their members.
      </Intro>
      {created ? <Banner tone="success">{created}</Banner> : null}
      {restore.error ? <Banner tone="danger">{restore.error.message}</Banner> : null}
      <SettingsSection title="All workspaces">
        {data && data.workspaces.length === 0 ? (
          <EmptyState title="No workspaces yet">
            Create one for an existing account to get started.
          </EmptyState>
        ) : (
          <div className={rows.box}>
            <div className={rows.head} aria-hidden="true">
              <span className={rows.tileSpacer} />
              <span className={rows.name}>Workspace</span>
              <span className={rows.num}>Members</span>
              <span className={rows.num}>Teams</span>
              <span className={rows.num}>Created</span>
              <span className={rows.action} />
            </div>
            <ul className={rows.list} aria-label="Workspaces">
              {data?.workspaces.map((w) => (
                <li key={w.id} className={rows.row}>
                  <span className={rows.tile} aria-hidden="true">
                    {w.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className={rows.name}>
                    <Text>{w.name}</Text>
                    <Text tone="tertiary" variant="small">
                      <Text variant="mono">{w.slug}</Text> · {formatBytes(w.storageBytes)}
                      {w.deletedAt ? (
                        <>
                          {' · '}
                          <Text as="span" tone="rejected" variant="small">
                            {deletedLabel(w.daysLeft)}
                          </Text>
                        </>
                      ) : null}
                    </Text>
                  </span>
                  <Text className={rows.num} variant="small">
                    <span style={visuallyHidden}>Members </span>
                    {w.memberCount}
                  </Text>
                  <Text className={rows.num} variant="small">
                    <span style={visuallyHidden}>Teams </span>
                    {w.teamCount}
                  </Text>
                  <Text className={rows.num} variant="small">
                    <span style={visuallyHidden}>Created </span>
                    {formatDay(w.createdAt)}
                  </Text>
                  <span className={rows.action}>
                    {w.deletedAt ? (
                      <>
                        <Button
                          size="sm"
                          loading={restore.isPending && restore.variables === w.id}
                          onClick={() =>
                            restore.mutate(w.id, {
                              onSuccess: () => setCreated(`Restored the workspace ${w.name}.`),
                            })
                          }
                        >
                          Restore
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setPurging(w)}>
                          Delete permanently now
                        </Button>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SettingsSection>
      {settings.data ? (
        <SettingsSection
          title="Who can create workspaces"
          description="Set on the server and changed by restarting it with a new value."
        >
          <SettingsRow
            label={WORKSPACE_CREATION_TEXT[settings.data.workspaceCreation]}
            detail={
              settings.data.workspaceCreation === 'admin'
                ? 'Everyone else joins through an invitation or a verified email domain. Set WORKSPACE_CREATION=anyone to let every signed-in account create one.'
                : 'Every signed-in account can create a workspace. Set WORKSPACE_CREATION=admin to limit it to instance admins.'
            }
            value={`WORKSPACE_CREATION=${settings.data.workspaceCreation}`}
          />
        </SettingsSection>
      ) : null}
      <ConfirmDialog
        open={purging !== null}
        onOpenChange={(open) => {
          if (!open) setPurging(null)
        }}
        title={`Delete ${purging?.name ?? ''} permanently?`}
        description="Its teams, builds, screenshots and settings are removed now, without waiting for the rest of the 30 days. This can’t be undone."
        confirmLabel="Delete permanently"
        confirmText={purging?.slug}
        loading={purge.isPending}
        onConfirm={() => {
          if (!purging) return
          purge.mutate(purging.id, {
            onSuccess: () => {
              setCreated(`Deleted ${purging.name} permanently.`)
              setPurging(null)
            },
          })
        }}
      />
      <CreateWorkspaceDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(name) => {
          setCreating(false)
          setCreated(`Created the workspace ${name}.`)
        }}
      />
    </AdminFrame>
  )
}

function CreateWorkspaceDialog(props: {
  open: boolean
  onClose: () => void
  onCreated: (name: string) => void
}) {
  const create = useCreateWorkspace()
  const [draft, setDraft] = useState<WorkspaceDraft>(emptyDraft)
  const [shown, setShown] = useState(false)
  const problems = workspaceProblems(draft)
  const slug = slugPreview(draft.name)

  function close() {
    setDraft(emptyDraft())
    setShown(false)
    create.reset()
    props.onClose()
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setShown(true)
    if (Object.keys(problems).length > 0) return
    create.mutate(draft, {
      onSuccess: ({ workspace }) => {
        setDraft(emptyDraft())
        setShown(false)
        props.onCreated(workspace.name)
      },
    })
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      title="Create workspace"
      actions={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            type="submit"
            form="create-workspace"
            variant="primary"
            loading={create.isPending}
          >
            Create workspace
          </Button>
        </>
      }
    >
      <form id="create-workspace" onSubmit={submit} noValidate className={styles.fields}>
        <TextField
          label="Name"
          value={draft.name}
          error={shown ? problems.name : undefined}
          description={slug ? `Address: ${slug}` : undefined}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          autoComplete="off"
        />
        <TextField
          label="Owner’s email"
          type="email"
          value={draft.ownerEmail}
          error={shown ? problems.ownerEmail : undefined}
          description="Must already have an account. They can invite the rest."
          onChange={(e) => setDraft({ ...draft, ownerEmail: e.target.value })}
          autoComplete="off"
        />
        {create.error ? <Banner tone="danger">{create.error.message}</Banner> : null}
      </form>
    </Dialog>
  )
}

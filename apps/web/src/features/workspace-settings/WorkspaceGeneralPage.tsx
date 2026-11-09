import {
  Banner,
  Button,
  SettingsRow,
  SettingsSection,
  Text,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { useDocumentTitle } from '#lib/document-title.ts'

import { workspaceGeneralQuery, useSaveWorkspaceGeneral } from './api.ts'
import { BuildSettings } from './BuildSettings.tsx'
import { DeleteWorkspaceSection } from './DeleteWorkspaceSection.tsx'
import { Frame } from './Frame.tsx'
import { generalDirty, generalPatch, generalProblems } from './model.ts'

import styles from './Settings.module.css'

const NOT_ALLOWED = 'Only owners and admins can change workspace settings.'

/** The workspace's name and address, the defaults its teams start from, and the danger zone. */
export function WorkspaceGeneralPage() {
  const { workspace } = useParams({ from: '/workspaces/$workspace/settings' })
  useDocumentTitle('General', workspace)
  const { data, error, refetch } = useQuery(workspaceGeneralQuery(workspace))

  return (
    <Frame
      workspace={{ slug: workspace, name: data?.name ?? workspace }}
      page="General"
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This workspace doesn’t exist"
      readOnlyNote={data && !data.canManage ? NOT_ALLOWED : false}
    >
      {data ? (
        <>
          <Text as="p" tone="secondary">
            The workspace’s name, its address in CirCI, and the defaults its teams start from.
          </Text>
          {/* Keyed by the saved values, so a save (or a rename elsewhere) resets the form. */}
          <IdentityForm
            key={`${data.name}/${data.slug}`}
            workspace={workspace}
            saved={{ name: data.name, slug: data.slug }}
            canManage={data.canManage}
          />
          <BuildSettings workspace={workspace} />
          <DeleteWorkspaceSection workspace={workspace} name={data.name} isOwner={data.isOwner} />
        </>
      ) : null}
    </Frame>
  )
}

function IdentityForm({ workspace, saved, canManage }: IdentityForm.Props) {
  const navigate = useNavigate()
  const announce = useAnnounce()
  const save = useSaveWorkspaceGeneral(workspace)
  const [draft, setDraft] = useState(saved)
  const [showProblems, setShowProblems] = useState(false)
  const problems = showProblems ? generalProblems(draft) : {}
  const dirty = generalDirty(saved, draft)
  const slugChanged = draft.slug !== saved.slug

  function submit(e: FormEvent) {
    e.preventDefault()
    setShowProblems(true)
    if (Object.keys(generalProblems(draft)).length > 0 || !dirty) return
    save.mutate(generalPatch(saved, draft), {
      onSuccess: (result) => {
        announce('Saved')
        // The address in the bar is the old one, which no longer works.
        if (result.slug !== workspace) {
          void navigate({
            to: '/workspaces/$workspace/settings',
            params: { workspace: result.slug },
            replace: true,
          })
        }
      },
    })
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="identity" className={styles.form}>
      <SettingsSection
        title={<span id="identity">Workspace</span>}
        description="Shown in the sidebar, in invitations and in pull request comments."
      >
        <SettingsRow>
          <div className={styles.fieldRow}>
            <TextField
              label="Name"
              name="name"
              value={draft.name}
              disabled={!canManage}
              error={problems.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <TextField
              label="URL slug"
              name="slug"
              value={draft.slug}
              disabled={!canManage}
              error={problems.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            />
          </div>
        </SettingsRow>
        {slugChanged ? (
          <SettingsRow>
            <Banner tone="warning">
              Links with <Text variant="mono">/{saved.slug}/</Text> in them stop working, including
              bookmarks and the links in existing pull request comments. New builds post the new
              address.
            </Banner>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
      {canManage ? (
        <div className={styles.footer}>
          <Button
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDraft(saved)
              setShowProblems(false)
              save.reset()
            }}
          >
            Discard
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      ) : null}
    </form>
  )
}

namespace IdentityForm {
  export interface Props {
    workspace: string
    saved: { name: string; slug: string }
    canManage: boolean
  }
}

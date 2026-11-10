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
import { InstantTextField } from '#lib/InstantTextField.tsx'

import { workspaceGeneralQuery, useSaveWorkspaceGeneral } from './api.ts'
import { BuildSettings } from './BuildSettings.tsx'
import { DeleteWorkspaceSection } from './DeleteWorkspaceSection.tsx'
import { Frame } from './Frame.tsx'
import { generalProblems } from './model.ts'
import { PictureRow } from './PictureRow.tsx'

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
          <IdentitySection
            workspace={workspace}
            name={data.name}
            picture={data.picture}
            canManage={data.canManage}
          />
          {/* Keyed by the saved address, so a save (or a rename elsewhere) resets the form. */}
          <AddressForm
            key={data.slug}
            workspace={workspace}
            saved={data.slug}
            canManage={data.canManage}
          />
          <BuildSettings workspace={workspace} />
          <DeleteWorkspaceSection workspace={workspace} name={data.name} isOwner={data.isOwner} />
        </>
      ) : null}
    </Frame>
  )
}

/** The name and picture: they change nobody's workflow, so each saves as soon as it is changed. */
function IdentitySection({ workspace, name, picture, canManage }: IdentitySection.Props) {
  const announce = useAnnounce()
  const save = useSaveWorkspaceGeneral(workspace)
  return (
    <SettingsSection
      title="Workspace"
      description="Shown in the sidebar, in invitations and in pull request comments. Saved as soon as you change them."
    >
      <PictureRow workspace={workspace} name={name} picture={picture} canManage={canManage} />
      <SettingsRow>
        <InstantTextField
          label="Name"
          name="name"
          saved={name}
          disabled={!canManage}
          mutation={save}
          validate={(next) => generalProblems({ name: next, slug: 'x' }).name ?? null}
          onCommit={(next) =>
            save.mutate({ name: next }, { onSuccess: () => announce('Name saved') })
          }
        />
      </SettingsRow>
    </SettingsSection>
  )
}

namespace IdentitySection {
  export interface Props {
    workspace: string
    name: string
    picture: string | null
    canManage: boolean
  }
}

/** The address breaks every link that has the old one in it, so it waits for Save (with its warning). */
function AddressForm({ workspace, saved, canManage }: AddressForm.Props) {
  const navigate = useNavigate()
  const announce = useAnnounce()
  const save = useSaveWorkspaceGeneral(workspace)
  const [slug, setSlug] = useState(saved)
  const [showProblems, setShowProblems] = useState(false)
  const problem = showProblems ? generalProblems({ name: 'x', slug }).slug : undefined
  const dirty = slug !== saved

  function submit(e: FormEvent) {
    e.preventDefault()
    setShowProblems(true)
    if (generalProblems({ name: 'x', slug }).slug || !dirty) return
    save.mutate(
      { slug },
      {
        onSuccess: (result) => {
          announce('Address saved')
          // The address in the bar is the old one, which no longer works.
          if (result.slug !== workspace) {
            void navigate({
              to: '/workspaces/$workspace/settings',
              params: { workspace: result.slug },
              replace: true,
            })
          }
        },
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="address" className={styles.form}>
      <SettingsSection
        title={<span id="address">Address</span>}
        description="Where the workspace lives in CirCI. Changing it breaks existing links."
      >
        <SettingsRow>
          <div className={styles.fieldRow}>
            <TextField
              label="URL slug"
              name="slug"
              value={slug}
              disabled={!canManage}
              error={problem}
              onChange={(e) => {
                setSlug(e.target.value)
                if (save.isError) save.reset()
              }}
            />
          </div>
        </SettingsRow>
        {dirty ? (
          <SettingsRow>
            <Banner tone="warning">
              Links with <Text variant="mono">/{saved}/</Text> in them stop working, including
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
              setSlug(saved)
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

namespace AddressForm {
  export interface Props {
    workspace: string
    saved: string
    canManage: boolean
  }
}

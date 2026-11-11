import { Avatar, SettingsRow, SettingsSection, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'

import { CheckedTextField } from '#lib/CheckedTextField.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { IdentityFields } from '#lib/IdentityFields.tsx'
import { toast } from '#lib/toast.ts'

import { workspaceGeneralQuery, useSaveWorkspaceGeneral, useSaveWorkspacePicture } from './api.ts'
import { BuildSettings } from './BuildSettings.tsx'
import { DeleteWorkspaceSection } from './DeleteWorkspaceSection.tsx'
import { Frame } from './Frame.tsx'
import { MembersRedirect } from './MembersRedirect.tsx'
import { generalProblems } from './model.ts'
import { PicturePanel } from './PicturePanel.tsx'

/** The workspace's name and address, the defaults its teams start from, and the danger zone. */
export function WorkspaceGeneralPage() {
  const { workspace } = useParams({ from: '/workspaces/$workspace/settings/general' })
  useDocumentTitle('General', workspace)
  const { data, error, refetch } = useQuery(workspaceGeneralQuery(workspace))

  return (
    <Frame
      workspace={{ slug: workspace, name: data?.name ?? workspace }}
      page="General"
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This workspace doesn't exist"
      forbidden={data && !data.canManage ? <MembersRedirect workspace={workspace} /> : null}
    >
      {data ? (
        <>
          <SettingsSection title="Display Settings">
            <IdentityRow
              workspace={workspace}
              name={data.name}
              slug={data.slug}
              picture={data.picture}
              canManage={data.canManage}
            />
          </SettingsSection>
          <BuildSettings workspace={workspace} />
          <DeleteWorkspaceSection workspace={workspace} name={data.name} isOwner={data.isOwner} />
        </>
      ) : null}
    </Frame>
  )
}

/**
 * The picture, the display name and the URL slug in one row. Each text field saves with its own ✓,
 * which appears while it differs from what is saved: the picture and the name change nobody's
 * workflow; the slug breaks every link that has the old one in it, so its warning stays under it.
 */
function IdentityRow({ workspace, name, slug, picture, canManage }: IdentityRow.Props) {
  const navigate = useNavigate()
  const saveName = useSaveWorkspaceGeneral(workspace)
  const saveSlug = useSaveWorkspaceGeneral(workspace)
  const savePicture = useSaveWorkspacePicture(workspace)
  return (
    <SettingsRow>
      <IdentityFields
        avatar={
          <Avatar
            type="workspace"
            slug={workspace}
            name={name}
            picture={picture}
            size={40}
            aria-hidden
          />
        }
        buttonLabel="Change picture"
        panelLabel="Picture"
        canEdit={canManage}
        panel={
          <PicturePanel
            picture={picture}
            mutation={savePicture}
            onSave={(file) =>
              savePicture.mutate(file, {
                onSuccess: () => toast(file ? 'Picture saved' : 'Picture removed'),
              })
            }
          />
        }
      >
        <CheckedTextField
          label="Display Name"
          name="name"
          saved={name}
          disabled={!canManage}
          mutation={saveName}
          validate={(next) => generalProblems({ name: next, slug: 'x' }).name ?? null}
          onCommit={(next) =>
            saveName.mutate({ name: next }, { onSuccess: () => toast('Name saved') })
          }
        />
        <CheckedTextField
          label="URL Slug"
          name="slug"
          saved={slug}
          disabled={!canManage}
          mutation={saveSlug}
          description="Where the workspace lives in CirCI. Changing it breaks existing links."
          dirtyDescription={
            <>
              Links with <Text variant="mono">/{slug}/</Text> in them stop working, including
              bookmarks and the links in existing pull request comments. New builds post the new
              address.
            </>
          }
          validate={(next) => generalProblems({ name: 'x', slug: next }).slug ?? null}
          onCommit={(next) =>
            saveSlug.mutate(
              { slug: next },
              {
                onSuccess: (result) => {
                  toast('URL slug saved')
                  // The address in the bar is the old one, which no longer works.
                  if (result.slug !== workspace) {
                    void navigate({
                      to: '/workspaces/$workspace/settings/general',
                      params: { workspace: result.slug },
                      replace: true,
                    })
                  }
                },
              },
            )
          }
        />
      </IdentityFields>
    </SettingsRow>
  )
}

namespace IdentityRow {
  export interface Props {
    workspace: string
    name: string
    slug: string
    picture: string | null
    canManage: boolean
  }
}

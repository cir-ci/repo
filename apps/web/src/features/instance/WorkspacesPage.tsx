import type { InstanceAdmin } from '@circi/api'
import { Avatar, BuildingIcon, Button, EmptyState, PlusIcon } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { formatBytes } from '#features/workspace-settings/api.ts'
import { hubSubtitle } from '#features/workspace-settings/hub-model.ts'
import { instanceCrumb } from '#lib/crumbs.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { useFindParam } from '#lib/find.ts'
import { SettingsList, SettingsListPage, SettingsListRow } from '#lib/SettingsListPage.tsx'
import { toast } from '#lib/toast.ts'

import { InstanceAdminsOnly } from './AdminFrame.tsx'
import { deletedLabel, isForbidden, workspacesQuery } from './api/admin.ts'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog.tsx'
import { findWorkspaces } from './workspaces-list.ts'

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

/**
 * Settings, Workspaces (instance admins; the All projects page's sibling): every workspace of the
 * instance with its size, each opening its settings hub, and the deleted ones in a group of their
 * own (days left to restore them, from their hub). New workspace is the header's button.
 */
export function WorkspacesPage() {
  useDocumentTitle('Workspaces')
  const query = useQuery(workspacesQuery())
  const [search, setSearch] = useFindParam()
  const [creating, setCreating] = useState(false)
  const found = findWorkspaces(query.data?.workspaces ?? [], search).toSorted(byName)
  const live = found.filter((w) => !w.deletedAt)
  const deleted = found.filter((w) => w.deletedAt)

  return (
    <>
      <SettingsListPage
        crumbs={[instanceCrumb()]}
        title="Workspaces"
        noun="workspaces"
        singular="workspace"
        search={search}
        onSearch={setSearch}
        count={found.length}
        actions={
          <Button
            variant="primary"
            leading={<PlusIcon size={14} />}
            onClick={() => setCreating(true)}
          >
            New workspace
          </Button>
        }
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        forbidden={isForbidden(query.error) ? <InstanceAdminsOnly /> : null}
        empty={<EmptyState icon={<BuildingIcon />} size="section" title="No workspaces yet" />}
      >
        {live.length > 0 ? (
          <SettingsList label="Workspaces">
            {live.map((w) => (
              <WorkspaceRow key={w.slug} workspace={w} />
            ))}
          </SettingsList>
        ) : null}
        {deleted.length > 0 ? (
          <SettingsList label="Deleted workspaces" title="Deleted">
            {deleted.map((w) => (
              <WorkspaceRow key={w.slug} workspace={w} />
            ))}
          </SettingsList>
        ) : null}
      </SettingsListPage>
      <CreateWorkspaceDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false)
          toast(`Created ${created}`)
        }}
      />
    </>
  )
}

function WorkspaceRow({ workspace: w }: WorkspaceRow.Props) {
  return (
    <SettingsListRow
      link={{ to: '/workspaces/$workspace/settings', params: { workspace: w.slug } }}
      leading={
        <Avatar
          type="workspace"
          aria-hidden
          slug={w.slug}
          name={w.name}
          picture={w.picture}
          size={24}
        />
      }
      name={w.name}
      detail={w.slug}
      trailing={
        w.deletedAt ? (
          <span>{deletedLabel(w.daysLeft)}</span>
        ) : (
          <>
            <span>{hubSubtitle(w.memberCount, w.projectCount)}</span>
            <span>{formatBytes(w.storageBytes)}</span>
          </>
        )
      }
    />
  )
}

namespace WorkspaceRow {
  export interface Props {
    workspace: InstanceAdmin.Workspace
  }
}

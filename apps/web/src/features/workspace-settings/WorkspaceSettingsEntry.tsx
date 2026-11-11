import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from '@tanstack/react-router'

import { capabilitiesQuery } from '#features/projects/api/index.ts'
import { PageFrame } from '#lib/PageFrame.tsx'

import { WorkspaceSettingsHubPage } from './WorkspaceSettingsHubPage.tsx'

/**
 * `/workspaces/<workspace>/settings`, the one address that has always meant "this workspace's
 * settings". Instance admins get the workspace's hub. Everyone else keeps what it meant before,
 * General (which sends a member on to Members), so old links, bookmarks and the `/<workspace>/settings`
 * shortcut still land on the right page.
 */
export function WorkspaceSettingsEntry() {
  const { workspace } = useParams({ from: '/workspaces/$workspace/settings' })
  const { data: caps, error, refetch } = useQuery(capabilitiesQuery())
  if (caps?.instanceAdmin) return <WorkspaceSettingsHubPage workspace={workspace} />
  if (caps)
    return <Navigate to="/workspaces/$workspace/settings/general" params={{ workspace }} replace />
  return (
    <PageFrame
      crumbs={[]}
      title="Settings"
      loading={!error}
      error={error}
      onRetry={() => void refetch()}
    />
  )
}

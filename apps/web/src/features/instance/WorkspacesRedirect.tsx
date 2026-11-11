import { useQuery } from '@tanstack/react-query'
import { Navigate } from '@tanstack/react-router'

import { AdminFrame } from './AdminFrame.tsx'
import { workspacesQuery } from './api/admin.ts'

/**
 * `/instance/workspaces`, the page the settings nav's Workspaces section replaced, kept so
 * bookmarks still work: it opens the first workspace's settings hub (by name), or Instance
 * settings when the instance has no workspace yet. Someone who isn't an instance admin gets the
 * frame's "Instance admins only".
 */
export function WorkspacesRedirect() {
  const { data, error, refetch } = useQuery(workspacesQuery())
  const first = data?.workspaces
    .filter((w) => !w.deletedAt)
    .toSorted((a, b) => a.name.localeCompare(b.name))[0]
  if (data && first)
    return (
      <Navigate to="/workspaces/$workspace/settings" params={{ workspace: first.slug }} replace />
    )
  if (data) return <Navigate to="/instance/settings" replace />
  return (
    <AdminFrame title="Workspaces" loading={!error} error={error} onRetry={() => void refetch()}>
      {null}
    </AdminFrame>
  )
}

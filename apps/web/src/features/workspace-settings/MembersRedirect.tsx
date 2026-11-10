import { Navigate } from '@tanstack/react-router'

/**
 * What a workspace settings page shows to someone who may not change those settings: nothing,
 * they are sent to Members, the one workspace settings page every member can open.
 */
export function MembersRedirect({ workspace }: MembersRedirect.Props) {
  return <Navigate to="/workspaces/$workspace/settings/members" params={{ workspace }} replace />
}

export namespace MembersRedirect {
  export interface Props {
    workspace: string
  }
}

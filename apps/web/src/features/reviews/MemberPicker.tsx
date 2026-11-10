import { Avatar, Dialog, ListRow, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { workspaceQuery } from '#features/members/api.ts'
import { teamMembersQuery } from '#features/teams/api/members.ts'
import { authClient } from '#lib/auth-client.ts'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'

import styles from '#lib/ListPage.module.css'

/** Who to ask for a review: the members of the build's workspace, one click each. */
export function MemberPicker({ workspace, team, open, onOpenChange, onPick }: MemberPicker.Props) {
  // A team's reviews are asked of the team's own members; with no team (a workspace-wide list) of anyone in the workspace.
  const workspaceMembers = useQuery({ ...workspaceQuery(workspace), enabled: open && !team })
  const teamMembers = useQuery({
    ...teamMembersQuery(workspace, team ?? ''),
    enabled: open && Boolean(team),
  })
  const { data: session } = authClient.useSession()
  const me = session?.user.id
  const source = team ? teamMembers : workspaceMembers
  const query = {
    error: source.error,
    refetch: source.refetch,
    data: team
      ? teamMembers.data?.members
      : workspaceMembers.data?.members.map((m) => ({
          id: m.userId,
          name: m.user.name,
          image: m.user.image ?? null,
        })),
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Request a review from">
      <QueryBoundary query={query} rows={3}>
        {(people) => (
          <ul aria-label="Members" className={styles.members}>
            {people
              .filter((m) => m.id !== me)
              .map((m) => (
                <li key={m.id}>
                  <ListRow
                    leading={<Avatar type="user" id={m.id} name={m.name} image={m.image} />}
                    onClick={() => {
                      onOpenChange(false)
                      onPick({ id: m.id, name: m.name })
                    }}
                  >
                    <Text truncate>{m.name}</Text>
                  </ListRow>
                </li>
              ))}
          </ul>
        )}
      </QueryBoundary>
      <Text variant="small" tone="secondary">
        You can't request a review from yourself.
      </Text>
    </Dialog>
  )
}

export namespace MemberPicker {
  export interface Props {
    workspace: string
    /** The team the review is asked in: only its members are offered. */
    team?: string | undefined
    open: boolean
    onOpenChange: (open: boolean) => void
    onPick: (member: { id: string; name: string }) => void
  }
}

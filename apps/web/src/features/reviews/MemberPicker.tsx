import { Avatar, Dialog, ListRow, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { workspaceQuery } from '#features/members/api.ts'
import { authClient } from '#lib/auth-client.ts'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'

import styles from '#lib/ListPage.module.css'

/** Who to ask for a review: the members of the build's workspace, one click each. */
export function MemberPicker({ workspace, open, onOpenChange, onPick }: MemberPicker.Props) {
  const query = useQuery({ ...workspaceQuery(workspace), enabled: open })
  const { data: session } = authClient.useSession()
  const me = session?.user.id
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Request a review from">
      <QueryBoundary query={query} rows={3}>
        {(data) => (
          <ul aria-label="Members" className={styles.members}>
            {data.members
              .filter((m) => m.userId !== me)
              .map((m) => (
                <li key={m.id}>
                  <ListRow
                    leading={<Avatar name={m.user.name} seed={m.user.id} />}
                    onClick={() => {
                      onOpenChange(false)
                      onPick({ id: m.userId, name: m.user.name })
                    }}
                  >
                    <Text truncate>{m.user.name}</Text>
                  </ListRow>
                </li>
              ))}
          </ul>
        )}
      </QueryBoundary>
      <Text variant="small" tone="secondary">
        You can’t request a review from yourself.
      </Text>
    </Dialog>
  )
}

export namespace MemberPicker {
  export interface Props {
    workspace: string
    open: boolean
    onOpenChange: (open: boolean) => void
    onPick: (member: { id: string; name: string }) => void
  }
}

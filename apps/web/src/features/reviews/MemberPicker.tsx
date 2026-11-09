import { Avatar, Dialog, ListRow, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { workspaceQuery } from '#features/members/api.ts'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'

import styles from '#lib/ListPage.module.css'

/** Who to ask for a review: the members of the build's workspace, one click each. */
export function MemberPicker({ workspace, open, onOpenChange, onPick }: MemberPicker.Props) {
  const query = useQuery({ ...workspaceQuery(workspace), enabled: open })
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Request a review from">
      <QueryBoundary query={query} rows={3}>
        {(data) => (
          <ul aria-label="Members" className={styles.members}>
            {data.members.map((m) => (
              <li key={m.id}>
                <ListRow
                  leading={<Avatar name={m.user.name} />}
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

import { Avatar, Delayed, Dialog, ListRow, ListSkeleton, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { workspaceQuery } from '#features/members/api.ts'
import { ErrorState } from '#lib/ErrorState.tsx'

import styles from '#lib/ListPage.module.css'

/** Who to ask for a review: the members of the build's workspace, one click each. */
export function MemberPicker({ workspace, open, onOpenChange, onPick }: MemberPicker.Props) {
  const { data, error, refetch } = useQuery({ ...workspaceQuery(workspace), enabled: open })
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Request a review from">
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <Delayed>
          <ListSkeleton rows={3} />
        </Delayed>
      ) : (
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

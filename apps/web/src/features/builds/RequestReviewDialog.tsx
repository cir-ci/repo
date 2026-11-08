import { Avatar, Banner, Dialog, Text, TextField, useAnnounce } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { workspaceQuery } from '#features/members/api.ts'

import { useRequestReview } from './discussion-api.ts'
import { matchMembers } from './mentions.ts'

import styles from './Discussion.module.css'

/** ⇧R: pick a workspace member to ask for a review of this build. */
export function RequestReviewDialog({
  open,
  onClose,
  workspace,
  team,
  number,
}: RequestReviewDialog.Props) {
  const [filter, setFilter] = useState('')
  const members = useQuery({ ...workspaceQuery(workspace), enabled: open })
  const request = useRequestReview(workspace, team, number)
  const announce = useAnnounce()

  const people = (members.data?.members ?? []).map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
  }))
  const shown = matchMembers(people, filter, 50)

  function choose(person: { userId: string; name: string }) {
    request.mutate(person.userId, {
      onSuccess: (result) => {
        announce(
          result.created
            ? `Asked ${person.name} to review.`
            : `${person.name} already has an open request.`,
        )
        setFilter('')
        onClose()
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setFilter('')
          request.reset()
          onClose()
        }
      }}
      title="Request a review"
      description="They are notified and the build shows up on their Reviews page."
    >
      <TextField
        label="Find a member"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoComplete="off"
        onKeyDown={(e) => {
          const first = shown[0]
          if (e.key === 'Enter' && first) {
            e.preventDefault()
            choose(first)
          }
        }}
      />
      {request.error ? <Banner tone="danger">{request.error.message}</Banner> : null}
      {members.isPending ? (
        <Text tone="secondary" role="status">
          Loading members…
        </Text>
      ) : shown.length === 0 ? (
        <Text tone="secondary">No one matches.</Text>
      ) : (
        <ul className={styles.people} aria-label="Members">
          {shown.map((p) => (
            <li key={p.userId}>
              <button
                type="button"
                className={styles.person}
                disabled={request.isPending}
                onClick={() => choose(p)}
              >
                <Avatar name={p.name} />
                <span>
                  <Text as="div">{p.name}</Text>
                  <Text as="div" variant="small" tone="secondary">
                    {p.email}
                  </Text>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

export namespace RequestReviewDialog {
  export interface Props {
    open: boolean
    onClose: () => void
    workspace: string
    team: string
    number: number
  }
}

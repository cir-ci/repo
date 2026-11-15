import { Avatar, Menu, Text } from '@circi/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'

import { activityQuery, useRequestReview } from '#features/builds/api/discussion.ts'
import { projectMembersQuery } from '#features/projects/api/members.ts'
import { authClient } from '#lib/auth-client.ts'
import { toast } from '#lib/toast.ts'
import { refreshAll, withUndo } from '#lib/undo.ts'

import { openReviewers } from './review-model.ts'

import styles from './RequestReviewPicker.module.css'

/** The menu's heading: the project's own members are who can be asked. */
const heading = (projectName: string | undefined) =>
  projectName ? `Request review from ${projectName} members` : 'Request review from'

/**
 * "Request review from": a menu anchored to its trigger, listing the project's members. Someone
 * already asked shows "Requested" as a plain row, not an item: the keyboard skips it and there is
 * nothing to click. Never yourself. A refusal is toasted ("Couldn't ask for a review: …").
 */
export function RequestReviewPicker({
  open,
  onOpenChange,
  trigger,
  workspace,
  project,
  projectName,
  number,
}: RequestReviewPicker.Props) {
  // Fetched only while open: the members and the session are loaded when someone asks.
  const members = useQuery({ ...projectMembersQuery(workspace, project), enabled: open })
  const activity = useQuery({ ...activityQuery(workspace, project, number), enabled: open })
  const request = useRequestReview(workspace, project, number)
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const me = session?.user.id
  const requested = openReviewers(activity.data?.events ?? [])

  function choose(person: { userId: string; name: string }) {
    request.mutate(person.userId, {
      onSuccess: (result) => {
        toast.show(
          result.requests[0]?.created
            ? withUndo(
                `Asked ${person.name} to review`,
                result.undo,
                { workspace, project },
                refreshAll(queryClient),
                "Couldn't cancel the request",
              )
            : { message: `${person.name} already has an open request` },
        )
      },
    })
  }

  // You can't ask yourself: you are never one of the choices.
  const people = (members.data?.members ?? []).filter((m) => m.id !== me)
  const items: Menu.Entry[] = [
    {
      type: 'content',
      name: heading(projectName),
      node: (
        <Text variant="small" tone="tertiary" className={styles.heading}>
          {heading(projectName)}
        </Text>
      ),
    },
    ...(members.isPending
      ? [{ label: 'Loading members…', disabled: true }]
      : people.length === 0
        ? [{ label: 'No one else is in this project.', disabled: true }]
        : people.map((m): Menu.Entry => {
            const avatar = <Avatar type="user" id={m.id} name={m.name} image={m.image} size={20} />
            // Base UI keeps a disabled menu item focusable, so someone already asked is not an item
            // at all: a plain row the arrow keys pass over and a click does nothing on.
            return requested.has(m.id)
              ? {
                  type: 'content',
                  name: `${m.name}, requested`,
                  node: (
                    <div className={styles.asked}>
                      {avatar}
                      <span className={styles.name}>{m.name}</span>
                      <Text variant="small" tone="tertiary">
                        Requested
                      </Text>
                    </div>
                  ),
                }
              : {
                  label: m.name,
                  icon: avatar,
                  disabled: request.isPending,
                  onSelect: () => choose({ userId: m.id, name: m.name }),
                }
          })),
    {
      type: 'content',
      name: 'Yourself',
      node: (
        <Text variant="small" tone="secondary" className={styles.footer}>
          You can't request a review from yourself.
        </Text>
      ),
    },
  ]

  return (
    <Menu
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      align="end"
      className={styles.popup}
      items={items}
    />
  )
}

export namespace RequestReviewPicker {
  export interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The button the menu hangs from ("Request review"). */
    trigger: ReactElement<Record<string, unknown>>
    workspace: string
    project: string
    /** The project's display name, for the heading ("Request review from web-app members"). */
    projectName?: string | undefined
    number: number
  }
}

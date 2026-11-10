import { Avatar, Banner, Popover, Text, useAnnounce } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import type { ReactElement } from 'react'

import { activityQuery, useRequestReview } from '#features/builds/api/discussion.ts'
import { workspaceQuery } from '#features/members/api.ts'
import { authClient } from '#lib/auth-client.ts'

import { openReviewers } from './review-model.ts'

import styles from './RequestReviewPicker.module.css'

/**
 * "Request review from": a popover anchored to its trigger, listing the workspace's members.
 * Someone already asked shows "Requested" and choosing them again does nothing. Never yourself.
 */
export function RequestReviewPicker({
  open,
  onOpenChange,
  trigger,
  ...build
}: RequestReviewPicker.Props) {
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      label="Request review from"
      align="end"
      className={styles.popup}
    >
      {/* Mounted only while open: the members and the session are fetched when someone asks. */}
      <Choices {...build} onClose={() => onOpenChange(false)} />
    </Popover>
  )
}

function Choices({ workspace, team, number, onClose }: Choices.Props) {
  const members = useQuery(workspaceQuery(workspace))
  const activity = useQuery(activityQuery(workspace, team, number))
  const request = useRequestReview(workspace, team, number)
  const announce = useAnnounce()
  const { data: session } = authClient.useSession()
  const me = session?.user.id
  const requested = openReviewers(activity.data?.events ?? [])

  // You can't ask yourself: you are never one of the choices.
  const people = (members.data?.members ?? [])
    .filter((m) => m.userId !== me)
    .map((m) => ({ userId: m.userId, name: m.user.name, image: m.user.image ?? null }))

  function choose(person: { userId: string; name: string; image: string | null }) {
    if (requested.has(person.userId)) return
    request.mutate(person.userId, {
      onSuccess: (result) => {
        announce(
          result.created
            ? `Asked ${person.name} to review.`
            : `${person.name} already has an open request.`,
        )
        onClose()
      },
    })
  }

  return (
    <>
      <Text variant="small" tone="tertiary" className={styles.heading}>
        Request review from
      </Text>
      {request.error ? <Banner tone="danger">{request.error.message}</Banner> : null}
      {members.isPending ? (
        <Text tone="secondary" role="status">
          Loading members…
        </Text>
      ) : people.length === 0 ? (
        <Text tone="secondary">No one else is in this workspace.</Text>
      ) : (
        <ul className={styles.people} aria-label="Members">
          {people.map((p) => {
            const asked = requested.has(p.userId)
            return (
              <li key={p.userId}>
                <button
                  type="button"
                  className={styles.person}
                  aria-disabled={asked || undefined}
                  disabled={request.isPending}
                  onClick={() => choose(p)}
                >
                  <Avatar type="user" id={p.userId} name={p.name} image={p.image} size={20} />
                  <span className={styles.name}>{p.name}</span>
                  {asked ? (
                    <Text variant="small" tone="tertiary">
                      Requested
                    </Text>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <Text variant="small" tone="secondary" className={styles.footer}>
        You can't request a review from yourself.
      </Text>
    </>
  )
}

namespace Choices {
  export interface Props {
    workspace: string
    team: string
    number: number
    onClose: () => void
  }
}

export namespace RequestReviewPicker {
  export interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The button the popover hangs from ("Request review"). */
    trigger: ReactElement<Record<string, unknown>>
    workspace: string
    team: string
    number: number
  }
}

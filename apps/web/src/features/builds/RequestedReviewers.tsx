import { Avatar, AvatarStack, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { activityQuery } from '#features/builds/api/discussion.ts'

import { openReviewerPeople, requestedFromLabel } from './review-model.ts'

import styles from './RequestedReviewers.module.css'

/**
 * Who has been asked to review, beside the "Request review" button: their avatars and
 * "Requested from Dana". Read from the build's activity (the picker's own source), so it appears
 * as soon as a request is made and goes when the request is closed. Nothing while no one is asked.
 */
export function RequestedReviewers({ workspace, project, number }: RequestedReviewers.Props) {
  const { data } = useQuery(activityQuery(workspace, project, number))
  const people = openReviewerPeople(data?.events ?? [])
  const label = requestedFromLabel(people)
  if (!label) return null
  return (
    <span className={styles.root}>
      <AvatarStack>
        {people.slice(0, 3).map((p) => (
          <Avatar key={p.id} type="user" {...p} size={20} />
        ))}
      </AvatarStack>
      <Text variant="small" tone="secondary" title={people.map((p) => p.name).join(', ')}>
        {label}
      </Text>
    </span>
  )
}

export namespace RequestedReviewers {
  export interface Props {
    workspace: string
    project: string
    number: number
  }
}

import type { Build } from '@circi/api'
import { Text } from '@circi/ui'

import { useNow } from '#lib/RelativeTime.tsx'

import { reviewTargetStatus } from './review-model.ts'

/**
 * The review target beside the build's status chip: "Review target: 22h left", and in red "Overdue 2h" once it is past. Nothing while no request is counting down.
 */
export function ReviewTarget({ target }: ReviewTarget.Props) {
  const now = useNow()
  const status = reviewTargetStatus(target, now)
  if (!status) return null
  return (
    <Text variant="small" tone={status.overdue ? 'rejected' : 'tertiary'}>
      {status.overdue ? status.short : `Review target: ${status.short}`}
    </Text>
  )
}

export namespace ReviewTarget {
  export interface Props {
    target: Build.Detail['reviewTarget']
  }
}

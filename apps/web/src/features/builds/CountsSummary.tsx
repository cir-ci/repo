import type { Build, DiffStatus, ReviewStatus } from '@circi/api'
import { Stack, StatusChip, Text } from '@circi/ui'

import { DIFF_LABEL, screenshotStatus } from './diff-status.ts'

/** "2 changed · 1 added …" as chips with the status glyph; zero counts are left out. */
export function CountsSummary({ counts, review, includeUnchanged = true }: CountsSummary.Props) {
  const order: DiffStatus[] = ['changed', 'added', 'removed', 'failed']
  if (includeUnchanged) order.push('unchanged')
  if (counts.total === 0) {
    return (
      <Text variant="small" tone="secondary">
        No screenshots
      </Text>
    )
  }
  return (
    <Stack direction="row" gap={2} wrap align="center">
      {order
        .filter((k) => counts[k] > 0)
        .map((k) => (
          <StatusChip key={k} status={screenshotStatus(k, review)}>
            {counts[k]} {k === 'failed' ? "couldn't be read" : DIFF_LABEL[k].toLowerCase()}
          </StatusChip>
        ))}
    </Stack>
  )
}

export namespace CountsSummary {
  export interface Props {
    counts: Build.Counts
    /** The build's review (`shotReview`): the chips' glyphs follow it. */
    review: ReviewStatus
    includeUnchanged?: boolean
  }
}

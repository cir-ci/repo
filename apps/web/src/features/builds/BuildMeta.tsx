import type { Build } from '@circi/api'
import { Stack, Text } from '@circi/ui'

import { RelativeTime } from '#lib/RelativeTime.tsx'

/** Metadata line for a build: PR, branch, commit, time. */
export function BuildMeta({ build, showBranch = true }: BuildMeta.Props) {
  return (
    <Stack direction="row" gap={2} wrap align="center">
      {build.prNumber ? (
        <Text variant="small" tone="secondary">
          PR #{build.prNumber}
        </Text>
      ) : null}
      {showBranch && build.branch ? (
        <Text variant="mono" tone="secondary">
          {build.branch}
        </Text>
      ) : null}
      <Text variant="mono" tone="secondary" title={build.commitSha}>
        {build.commitSha.slice(0, 7)}
      </Text>
      <Text variant="small" tone="secondary">
        <RelativeTime iso={build.createdAt} />
      </Text>
    </Stack>
  )
}

export namespace BuildMeta {
  export interface Props {
    build: Pick<Build.ListItem, 'branch' | 'prNumber' | 'commitSha' | 'createdAt'>
    /** Leave the branch out when the page shows it elsewhere. */
    showBranch?: boolean
  }
}

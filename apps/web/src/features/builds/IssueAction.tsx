import type { Build } from '@circi/api'
import { Button } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { isActive } from '#features/builds/api/index.ts'
import { issuePreview, issuesQuery, useCreateIssue } from '#features/builds/api/issues.ts'

import { CreateIssueDialog } from './CreateIssueDialog.tsx'

/**
 * "Create issue" in the review header, for the selected snapshot (the whole build when none is
 * selected). Shown only when the team has a tracker (Linear or Jira) mapped, so a team
 * without one sees nothing.
 */
export function IssueAction({ data, snapshotName }: IssueAction.Props) {
  const { team, build } = data
  const { data: issues } = useQuery({
    ...issuesQuery(team.workspaceSlug, team.slug, build.number),
    enabled: !isActive(build.status) && build.status !== 'expired',
  })
  const create = useCreateIssue(team.workspaceSlug, team.slug, build.number)
  const [open, setOpen] = useState(false)
  if (!issues || issues.trackers.length === 0) return null
  const preview = issuePreview(data, snapshotName, window.location.origin)

  return (
    <>
      <Button
        onClick={() => {
          create.reset()
          setOpen(true)
        }}
      >
        Create issue
      </Button>
      <CreateIssueDialog
        // A new selection starts a new draft.
        key={snapshotName ?? ''}
        open={open}
        trackers={issues.trackers}
        snapshotName={snapshotName}
        defaultTitle={preview.title}
        description={preview.description}
        pending={create.isPending}
        error={create.error}
        onCancel={() => setOpen(false)}
        onCreate={(input, onCreated) =>
          create.mutate(input, {
            onSuccess: (issue) => {
              onCreated(issue)
              setOpen(false)
            },
          })
        }
      />
    </>
  )
}

export namespace IssueAction {
  export interface Props {
    data: Build.Detail
    snapshotName: string | null
  }
}

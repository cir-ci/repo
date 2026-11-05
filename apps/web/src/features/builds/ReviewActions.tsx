import type { Build, ReviewState } from '@circi/api'
import CancelOutlined from '@mui/icons-material/CancelOutlined'
import TaskAlt from '@mui/icons-material/TaskAlt'
import { Alert, Button, Stack, Typography } from '@mui/material'

import { RelativeTime } from '../../components.tsx'
import { useAnnounce } from '../../primitives/feedback.tsx'
import { useReviewBuild } from './api.ts'

/**
 * Approve and reject, for a finished build with changes. Only the decision that isn't already
 * in force is offered, so after approving you're left with "Reject" to change your mind.
 */
export function ReviewActions(props: ReviewActions.Props) {
  const { build, project } = props.data
  const review = useReviewBuild(project.orgSlug, project.slug, build.number)
  const announce = useAnnounce()

  function decide(state: ReviewState) {
    review.mutate(state, {
      onSuccess: () => announce(`Build #${build.number} ${state}.`),
    })
  }

  return (
    <Stack spacing={1} sx={{ alignItems: 'flex-end' }}>
      <Stack direction="row" spacing={1}>
        {build.reviewStatus !== 'rejected' ? (
          <Button
            variant="outlined"
            color="error"
            startIcon={<CancelOutlined />}
            disabled={review.isPending}
            onClick={() => decide('rejected')}
          >
            Reject
          </Button>
        ) : null}
        {build.reviewStatus !== 'approved' ? (
          <Button
            variant="contained"
            color="success"
            startIcon={<TaskAlt />}
            disabled={review.isPending}
            onClick={() => decide('approved')}
            title="Accept these changes. Later builds are compared with this one."
          >
            Approve
          </Button>
        ) : null}
      </Stack>
      {review.error ? (
        <Alert severity="error" sx={{ maxWidth: 360 }}>
          {review.error.message}
        </Alert>
      ) : null}
    </Stack>
  )
}

export namespace ReviewActions {
  export interface Props {
    data: Build.Detail
  }
}

/** One line on where the build stands: who decided and when, or that it still needs a decision. */
export function ReviewNote({ data }: ReviewNote.Props) {
  const { build, reviews } = data
  if (build.status !== 'complete' || build.conclusion !== 'changes_detected') return null
  const latest = reviews[0]
  if (!latest || build.reviewStatus === 'pending') {
    return (
      <Typography color="text.secondary">
        These changes need a decision. Approving makes this build the baseline that later builds are
        compared with.
      </Typography>
    )
  }
  const verb = latest.state === 'approved' ? 'Approved' : 'Rejected'
  return (
    <Typography color="text.secondary">
      {latest.source === 'auto' ? (
        <>Approved automatically, because it’s a build on the default branch.</>
      ) : latest.source === 'rerun' ? (
        <>
          Approved automatically: this commit’s exact screenshots were approved in an earlier build.
        </>
      ) : (
        <>
          {verb} by {latest.userName ?? 'someone whose account was removed'}{' '}
          <RelativeTime iso={latest.createdAt} />.
        </>
      )}
    </Typography>
  )
}

export namespace ReviewNote {
  export interface Props {
    data: Build.Detail
  }
}

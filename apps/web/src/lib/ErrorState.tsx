import { Button, EmptyState, RefreshIcon, WarningIcon } from '@circi/ui'

import { HttpError } from './http.ts'

/**
 * Error state: what went wrong in plain words and the way to recover.
 * A 404 gets the page's own "not found" message; anything else offers to retry.
 */
export function ErrorState(props: ErrorState.Props) {
  if (props.error instanceof HttpError && props.error.status === 404 && props.notFound) {
    return (
      <EmptyState tone="failed" icon={<WarningIcon size={32} />} title={props.notFound}>
        It may have expired, or the link may be wrong.
      </EmptyState>
    )
  }
  return (
    <EmptyState
      tone="failed"
      icon={<WarningIcon size={32} />}
      title="This page couldn't be loaded"
      action={
        props.onRetry ? (
          <Button variant="secondary" leading={<RefreshIcon />} onClick={props.onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      {props.error.message}
    </EmptyState>
  )
}

export namespace ErrorState {
  export interface Props {
    error: Error
    onRetry?: () => void
    notFound?: string
  }
}

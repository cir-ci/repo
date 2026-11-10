import { EmptyState, Text, WarningIcon } from '@circi/ui'
import type { ReactNode } from 'react'

import { PageFrame } from '#lib/PageFrame.tsx'
import { usePhone } from '#lib/use-phone.ts'

import { isForbidden } from './api/admin.ts'

/**
 * The frame every Instance page shares: the header (Instance, then the page's name as the `<h1>`,
 * with its main button on the same line) and one column, with the loading and error states, and
 * the state for someone who is not an instance admin (the server answers 403 to every
 * `/api/instance` read). The page's name is not repeated as a title in the column.
 */
export function AdminFrame({ title, action, note, error, children, ...rest }: AdminFrame.Props) {
  // The status line sits beside the title; a phone's header has no room for it, so it leads the page.
  const phone = usePhone()
  const status = note ? (
    <Text variant="small" tone="tertiary">
      {note}
    </Text>
  ) : null
  return (
    <PageFrame
      crumbs={[{ label: 'Instance' }]}
      title={title}
      error={error}
      {...(action ? { actions: action } : {})}
      {...(status && !phone ? { after: status } : {})}
      forbidden={
        isForbidden(error) ? (
          <EmptyState tone="failed" icon={<WarningIcon size={32} />} title="Instance admins only">
            Only instance admins can see this page. Ask one to make you an instance admin.
          </EmptyState>
        ) : null
      }
      {...rest}
    >
      {phone ? status : null}
      {children}
    </PageFrame>
  )
}

export namespace AdminFrame {
  export interface Props {
    /** The page's name: the `<h1>`, after "Instance". */
    title: string
    /** The page's main button, in the header on the title's line. */
    action?: ReactNode
    /** A status line beside the title (not an explanation of the page). */
    note?: ReactNode
    loading?: boolean
    error?: Error | null | undefined
    onRetry?: () => void
    children: ReactNode
  }
}

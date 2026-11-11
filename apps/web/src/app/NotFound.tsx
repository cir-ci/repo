import { EmptyState } from '@circi/ui'

import { RouterLink } from '#lib/router-link.ts'

/** The 404 page, rendered inside the shell (docs/design-gaps.md §5). */
export function NotFound() {
  return (
    <EmptyState headingLevel={1} title="This page doesn't exist">
      Check the address, or start again from the <RouterLink to="/">list of projects</RouterLink>.
    </EmptyState>
  )
}

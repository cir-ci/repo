import { Breadcrumbs, EmptyState, PanelHeader } from '@circi/ui'

import { useDocumentTitle } from '../lib/document-title.ts'

/**
 * Stands in for a page that is planned but not built (docs/next-steps-plan.md, Phase C). The
 * agent who builds the page deletes its line from `placeholder-routes.tsx` and registers the real
 * route in its own feature's `routes.ts`.
 */
export function ComingSoon({ title }: ComingSoon.Props) {
  useDocumentTitle(title)
  return (
    <>
      <PanelHeader>
        <Breadcrumbs items={[{ label: title }]} />
      </PanelHeader>
      <EmptyState title={title} headingLevel={1}>
        This page is coming soon.
      </EmptyState>
    </>
  )
}

export namespace ComingSoon {
  export interface Props {
    title: string
  }
}

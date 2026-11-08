import { Breadcrumbs } from '@circi/ui'

import { useClientLink } from '#lib/use-client-link.ts'

/**
 * Breadcrumbs that navigate through the router: a real `href` (open in a new tab works), no page
 * reload on a plain click. A crumb without `link` is plain text (a workspace has no page here).
 */
export function TeamBreadcrumbs({ items }: TeamBreadcrumbs.Props) {
  const clientLink = useClientLink()
  return (
    <Breadcrumbs
      items={items.map((item) => {
        const link = item.link
        if (!link) return { label: item.label }
        return { label: item.label, ...clientLink(link) }
      })}
    />
  )
}

export namespace TeamBreadcrumbs {
  export interface Crumb {
    label: string
    link?: { to: '/' } | { to: '/$workspace/$team'; params: { workspace: string; team: string } }
  }
  export interface Props {
    items: ReadonlyArray<Crumb>
  }
}

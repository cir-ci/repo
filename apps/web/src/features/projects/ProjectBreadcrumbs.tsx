import { Breadcrumbs } from '@circi/ui'

import { useClientLink } from '#lib/use-client-link.ts'

/**
 * Breadcrumbs that navigate through the router: a real `href` (open in a new tab works), no page
 * reload on a plain click. A crumb without `link` is plain text (an organization has no page here).
 */
export function ProjectBreadcrumbs({ items }: ProjectBreadcrumbs.Props) {
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

export namespace ProjectBreadcrumbs {
  export interface Crumb {
    label: string
    link?: { to: '/' } | { to: '/$org/$project'; params: { org: string; project: string } }
  }
  export interface Props {
    items: ReadonlyArray<Crumb>
  }
}

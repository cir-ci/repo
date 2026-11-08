import { Breadcrumbs } from '@circi/ui'

import { useClientLink } from '#lib/use-client-link.ts'

/** `project / Build #148`: the project is a link, routed on the client. */
export function BuildBreadcrumbs({ org, project, number, name }: BuildBreadcrumbs.Props) {
  const clientLink = useClientLink()
  return (
    <Breadcrumbs
      items={[
        { label: project, ...clientLink({ to: '/$org/$project', params: { org, project } }) },
        { label: name && name !== 'default' ? `Build #${number} · ${name}` : `Build #${number}` },
      ]}
    />
  )
}

export namespace BuildBreadcrumbs {
  export interface Props {
    org: string
    project: string
    number: number
    /** The build's name; "default" (the usual one) is left out. */
    name?: string
  }
}

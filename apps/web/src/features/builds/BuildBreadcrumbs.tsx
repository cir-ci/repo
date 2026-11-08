import { Breadcrumbs } from '@circi/ui'

import { useClientLink } from '#lib/use-client-link.ts'

/** `team / Build #148`: the team is a link, routed on the client. */
export function BuildBreadcrumbs({ workspace, team, number, name }: BuildBreadcrumbs.Props) {
  const clientLink = useClientLink()
  return (
    <Breadcrumbs
      items={[
        { label: team, ...clientLink({ to: '/$workspace/$team', params: { workspace, team } }) },
        { label: name && name !== 'default' ? `Build #${number} · ${name}` : `Build #${number}` },
      ]}
    />
  )
}

export namespace BuildBreadcrumbs {
  export interface Props {
    workspace: string
    team: string
    number: number
    /** The build's name; "default" (the usual one) is left out. */
    name?: string
  }
}

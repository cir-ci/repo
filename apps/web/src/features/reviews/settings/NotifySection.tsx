import { Button, SettingsSection } from '@circi/ui'

import { useClientLink } from '#lib/use-client-link.ts'

/** Where review news goes: set in the workspace's integrations, or sent on through webhooks. */
export function NotifySection({ workspace, team }: NotifySection.Props) {
  const clientLink = useClientLink()
  const integrations = clientLink({
    to: '/workspaces/$workspace/settings/integrations',
    params: { workspace },
  })
  const webhooks = clientLink({
    to: '/$workspace/$team/settings/webhooks',
    params: { workspace, team },
  })
  return (
    <SettingsSection
      title="Notify a channel"
      description={
        <>
          Review requests, overdue reviews and rejections post to the chat channels you connect.
          Channels, issue trackers and Figma are set per team in{' '}
          <Button variant="link" size="sm" {...integrations}>
            workspace integrations
          </Button>
          ; anything else can use{' '}
          <Button variant="link" size="sm" {...webhooks}>
            webhooks
          </Button>
          .
        </>
      }
      bare
    />
  )
}

export namespace NotifySection {
  export interface Props {
    workspace: string
    team: string
  }
}

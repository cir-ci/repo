import type { Integration } from '@circi/api'
import { Banner, Button, Collapsible, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { useInstall } from '#features/integrations/api/generic.ts'
import { ConnectForm } from '#features/integrations/ConnectForm.tsx'

import { githubAppQuery, githubStep } from './api/github-app.ts'

/**
 * The Add dialog's GitHub step. With a GitHub App (from the environment or created on the instance
 * page) it goes straight to "Install on GitHub"; GitHub brings the person back with the workspace
 * named in a signed state. Without one, an instance admin is sent to the instance page and anyone
 * else is told to ask. Connecting by installation id stays below, for an App installed by hand.
 */
export function GithubAddPanel({ entry, workspace, onDone }: GithubAddPanel.Props) {
  const { data, error } = useQuery(githubAppQuery())
  const install = useInstall(workspace)
  if (error) return <Banner tone="danger">{error.message}</Banner>
  if (!data) return <Text tone="secondary">Checking the GitHub App…</Text>
  const step = githubStep(data)

  return (
    <div>
      {step === 'install' ? (
        <>
          <Text tone="secondary">
            Install the GitHub App on your account or organization, choose the repositories, and you
            come back here connected.
          </Text>
          {install.error ? <Banner tone="danger">{install.error.message}</Banner> : null}
          <Button
            variant="primary"
            loading={install.isPending}
            onClick={() => install.mutate('github')}
          >
            Install on GitHub
          </Button>
          <Collapsible title="Advanced: connect by installation ID">
            <ConnectForm entry={entry} workspace={workspace} onDone={onDone} />
          </Collapsible>
        </>
      ) : step === 'set-up' ? (
        <>
          <Text tone="secondary">This instance has no GitHub App yet.</Text>
          <Link to="/instance/settings">Set up the GitHub App</Link>
        </>
      ) : (
        <Banner>An administrator of this instance must set up the GitHub App first.</Banner>
      )}
    </div>
  )
}

export namespace GithubAddPanel {
  export interface Props {
    entry: Integration.CatalogEntry
    workspace: string
    onDone: () => void
  }
}

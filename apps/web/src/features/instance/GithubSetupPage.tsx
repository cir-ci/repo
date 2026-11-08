import { Banner, Button, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'

import { useConnect } from '#features/integrations/generic-api.ts'
import { Frame } from '#features/settings/Frame.tsx'
import { capabilitiesQuery } from '#features/teams/api.ts'
import { useDocumentTitle } from '#lib/document-title.ts'

/**
 * Where GitHub's install return lands when the App was installed from GitHub itself (no workspace
 * was named): the signed-in admin picks the workspace the installation belongs to.
 */
export function GithubSetupPage() {
  useDocumentTitle('Connect GitHub')
  const search: { installation_id?: unknown } = useSearch({ strict: false })
  const installation = typeof search.installation_id === 'string' ? search.installation_id : ''
  const { data, error, refetch } = useQuery(capabilitiesQuery())

  return (
    <Frame
      crumbs={['Integrations', 'Connect GitHub']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
    >
      {installation === '' ? (
        <Banner tone="danger">GitHub did not say which installation to connect.</Banner>
      ) : (data?.manageableWorkspaces.length ?? 0) === 0 ? (
        <Banner>Only workspace owners and admins can connect GitHub.</Banner>
      ) : (
        <>
          <Text tone="secondary">Choose the workspace this GitHub installation belongs to.</Text>
          {data?.manageableWorkspaces.map((workspace) => (
            <Pick key={workspace.slug} workspace={workspace} installation={installation} />
          ))}
        </>
      )}
    </Frame>
  )
}

function Pick(props: { workspace: { slug: string; name: string }; installation: string }) {
  const connect = useConnect(props.workspace.slug, 'github')
  const navigate = useNavigate()
  return (
    <div>
      <Button
        loading={connect.isPending}
        onClick={() =>
          connect.mutate(
            { installationId: props.installation },
            {
              onSuccess: ({ id }) =>
                void navigate({
                  to: '/workspaces/$workspace/settings/integrations/$kind/$id',
                  params: { workspace: props.workspace.slug, kind: 'github', id },
                }),
            },
          )
        }
      >
        {props.workspace.name}
      </Button>
      {connect.error ? <Banner tone="danger">{connect.error.message}</Banner> : null}
    </div>
  )
}

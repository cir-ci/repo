import { Banner, Button, Heading, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'

import { useConnect } from '#features/integrations/generic-api.ts'
import { capabilitiesQuery } from '#features/projects/api.ts'
import { Frame } from '#features/settings/Frame.tsx'
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
      crumbs={['Integrations', 'GitHub']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
    >
      <Heading level="title" as="h1">
        Connect GitHub
      </Heading>
      {installation === '' ? (
        <Banner tone="danger">GitHub did not say which installation to connect.</Banner>
      ) : (data?.manageableOrganizations.length ?? 0) === 0 ? (
        <Banner>Only workspace owners and admins can connect GitHub.</Banner>
      ) : (
        <>
          <Text tone="secondary">Choose the workspace this GitHub installation belongs to.</Text>
          {data?.manageableOrganizations.map((org) => (
            <Pick key={org.slug} org={org} installation={installation} />
          ))}
        </>
      )}
    </Frame>
  )
}

function Pick(props: { org: { slug: string; name: string }; installation: string }) {
  const connect = useConnect(props.org.slug, 'github')
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
                  to: '/organizations/$org/settings/integrations/$kind/$id',
                  params: { org: props.org.slug, kind: 'github', id },
                }),
            },
          )
        }
      >
        {props.org.name}
      </Button>
      {connect.error ? <Banner tone="danger">{connect.error.message}</Banner> : null}
    </div>
  )
}

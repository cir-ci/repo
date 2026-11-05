import { Alert, Box, Link, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { ErrorState, RelativeTime, useDocumentTitle } from '../../components.tsx'
import { Blankslate } from '../../primitives/Blankslate.tsx'
import { ListSkeleton } from '../../primitives/feedback.tsx'
import { PageHeader } from '../../primitives/PageHeader.tsx'
import { PageLayout } from '../../primitives/PageLayout.tsx'
import { Row, Section } from '../../primitives/Rows.tsx'
import { projectSitesQuery } from './api.ts'

const kb = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} kB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * A project's hosted sites: each branch's current address, and recent uploads by commit. The
 * dashboard only links out; the sites are served from their own domain and ask you to sign in.
 */
export function ProjectSitesPage() {
  const { org, project } = useParams({ from: '/$org/$project/sites' })
  const { data, error, refetch } = useQuery(projectSitesQuery(org, project))
  useDocumentTitle('Sites', project)

  return (
    <PageLayout
      header={
        <PageHeader
          title={`${project} sites`}
          description="Storybook, test reports and other sites uploaded from CI. Opening one asks you to sign in on its own address."
        />
      }
    >
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          notFound="This project doesn’t exist"
        />
      ) : !data ? (
        <ListSkeleton rows={3} />
      ) : !data.configured ? (
        <Alert severity="info">
          Static site hosting isn’t set up on this server. Set STATIC_SITES_HOST to a separate
          domain to turn it on.
        </Alert>
      ) : data.sites.length === 0 ? (
        <Blankslate
          border
          icon={<span aria-hidden>🌐</span>}
          heading="No sites yet"
          description="Upload a built Storybook or report from CI. Hosting also has to be switched on in the project’s settings."
          code={'CIRCI_TOKEN=… CIRCI_API_URL=… \\\n  npx circi storybook upload ./storybook-static'}
        />
      ) : (
        <Stack spacing={4}>
          {data.sites.map((site) => (
            <Box key={site.slug} component="section">
              <Typography variant="h2" component="h2" sx={{ mb: 1.5 }}>
                {site.name}{' '}
                <Typography component="span" color="text.secondary">
                  · {site.kindLabel}
                </Typography>
              </Typography>
              <Stack spacing={3}>
                {site.branches.length > 0 ? (
                  <Section title="Branches" count={site.branches.length}>
                    {site.branches.map((b) => (
                      <Row
                        key={b.address}
                        primary={
                          <Link href={b.address} target="_blank" rel="noreferrer">
                            {b.branch}
                          </Link>
                        }
                        secondary={
                          <>
                            commit {b.commitSha.slice(0, 7)} · updated{' '}
                            <RelativeTime iso={b.updatedAt} />
                          </>
                        }
                      />
                    ))}
                  </Section>
                ) : null}
                <Section title="Uploads" count={site.versions.length}>
                  {site.versions.map((v) => (
                    <Row
                      key={v.commitSha}
                      primary={
                        v.address ? (
                          <Link href={v.address} target="_blank" rel="noreferrer">
                            {v.commitSha.slice(0, 7)}
                          </Link>
                        ) : (
                          v.commitSha.slice(0, 7)
                        )
                      }
                      secondary={
                        <>
                          {v.branch ? `${v.branch} · ` : ''}
                          {kb(v.totalBytes)} · <RelativeTime iso={v.createdAt} />
                        </>
                      }
                    />
                  ))}
                </Section>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
    </PageLayout>
  )
}

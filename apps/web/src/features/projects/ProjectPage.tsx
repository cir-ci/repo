import CollectionsOutlined from '@mui/icons-material/CollectionsOutlined'
import { Box, Button, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { createLink, useParams, useSearch } from '@tanstack/react-router'

import {
  BuildMeta,
  BuildStateLabel,
  CountsSummary,
  ErrorState,
  RouterLink,
  useDocumentTitle,
} from '../../components.tsx'
import { Blankslate } from '../../primitives/Blankslate.tsx'
import { ListSkeleton } from '../../primitives/feedback.tsx'
import { BranchName } from '../../primitives/labels.tsx'
import { PageHeader } from '../../primitives/PageHeader.tsx'
import { PageLayout } from '../../primitives/PageLayout.tsx'
import { BUILDS_PAGE_SIZE, projectQuery } from './api.ts'

const ButtonLink = createLink(Button)

export function ProjectPage() {
  const { org, project } = useParams({ from: '/$org/$project' })
  const { before } = useSearch({ from: '/$org/$project' })
  const { data, error, refetch } = useQuery(projectQuery(org, project, before))
  useDocumentTitle(before ? 'Older builds' : 'Builds', data?.project.name ?? project)

  const builds = data?.builds ?? []
  const oldest = builds.at(-1)?.number

  return (
    <PageLayout
      header={
        <PageHeader
          // The project name only arrives with the data; the slug keeps the header from jumping.
          title={data?.project.name ?? project}
          actions={
            <ButtonLink to="/$org/$project/settings" params={{ org, project }} size="small">
              Settings
            </ButtonLink>
          }
          description={
            data ? (
              <>
                Screenshot builds from CI. Builds on{' '}
                <BranchName>{data.project.defaultBranch}</BranchName> become the baselines that pull
                requests are compared with.
              </>
            ) : undefined
          }
        />
      }
    >
      <Typography variant="h2" component="h2" sx={{ mb: 1.5 }}>
        {before ? 'Older builds' : 'Builds'}
      </Typography>
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          notFound="This project doesn’t exist"
        />
      ) : !data ? (
        <ListSkeleton />
      ) : builds.length === 0 ? (
        <Blankslate
          border
          icon={<CollectionsOutlined />}
          heading={before ? 'No older builds' : 'No builds yet'}
          description={
            before
              ? undefined
              : 'Upload screenshots from your CI job. Builds appear here as soon as they’re processed.'
          }
          code={
            before
              ? undefined
              : `CIRCI_TOKEN=… CIRCI_API_URL=${window.location.origin} \\\n  npx circi upload ./screenshots --wait`
          }
        />
      ) : (
        <>
          <Box
            component="ul"
            aria-label="Builds"
            sx={{ m: 0, p: 0, border: 1, borderColor: 'divider', borderRadius: 1 }}
          >
            {builds.map((b, i) => (
              <Box
                component="li"
                key={b.id}
                sx={{
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: { xs: 'column', md: 'row' },
                  alignItems: { xs: 'flex-start', md: 'center' },
                  gap: 1.5,
                  px: 2,
                  py: 1.5,
                  borderTop: i === 0 ? 0 : 1,
                  borderColor: 'divider',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                {/* Fixed-width column so build titles line up whatever the state's label length. */}
                <Box sx={{ width: { md: 148 }, flexShrink: 0 }}>
                  <BuildStateLabel build={b} size="small" />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography component="h3" sx={{ fontWeight: 600 }}>
                    <RouterLink
                      to="/$org/$project/builds/$number"
                      params={{ org, project, number: String(b.number) }}
                      color="text.primary"
                    >
                      Build #{b.number}
                      {b.name !== 'default' ? (
                        <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
                          {' '}
                          · {b.name}
                        </Box>
                      ) : null}
                    </RouterLink>
                  </Typography>
                  <Box sx={{ mt: 0.25 }}>
                    <BuildMeta build={b} />
                  </Box>
                </Box>
                <CountsSummary counts={b.counts} includeUnchanged={false} />
              </Box>
            ))}
          </Box>
          {/* Primer: pagination sits directly below the collection it pages. */}
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 2 }}>
            {before ? (
              <ButtonLink
                variant="outlined"
                to="/$org/$project"
                params={{ org, project }}
                search={{}}
              >
                Newest builds
              </ButtonLink>
            ) : null}
            {builds.length === BUILDS_PAGE_SIZE && oldest ? (
              <ButtonLink
                variant="outlined"
                to="/$org/$project"
                params={{ org, project }}
                search={{ before: oldest }}
              >
                Older builds
              </ButtonLink>
            ) : null}
          </Box>
        </>
      )}
    </PageLayout>
  )
}

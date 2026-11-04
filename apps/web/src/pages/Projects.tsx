import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined'
import { Box, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'

import { projectsQuery } from '../api.ts'
import {
  BuildMeta,
  BuildStateLabel,
  CountsSummary,
  ErrorState,
  RouterLink,
  useDocumentTitle,
} from '../components.tsx'
import { Blankslate } from '../primitives/Blankslate.tsx'
import { ListSkeleton } from '../primitives/feedback.tsx'
import { PageHeader } from '../primitives/PageHeader.tsx'
import { PageLayout } from '../primitives/PageLayout.tsx'

export function ProjectsPage() {
  useDocumentTitle('Projects')
  const { data, error, refetch } = useQuery(projectsQuery())

  return (
    <PageLayout
      header={
        <PageHeader
          title="Projects"
          description="Each project receives screenshot builds from one repository’s CI."
        />
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <ListSkeleton rows={3} />
      ) : data.projects.length === 0 ? (
        <Blankslate
          border
          icon={<FolderOpenOutlined />}
          heading="Create your first project"
          description="A project holds the screenshot builds of one repository. Create one on the server, then add its CI token to your CI."
          code={
            'circi admin org create --name "Acme"\ncirci admin project create --org acme --name "Web app"'
          }
        />
      ) : (
        <Box component="ul" sx={{ m: 0, p: 0, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {data.projects.map(({ org, project, latestBuild }, i) => (
            <Box
              component="li"
              key={`${org.slug}/${project.slug}`}
              sx={{
                listStyle: 'none',
                display: 'flex',
                alignItems: { xs: 'flex-start', md: 'center' },
                flexDirection: { xs: 'column', md: 'row' },
                gap: 1.5,
                px: 2,
                py: 1.5,
                borderTop: i === 0 ? 0 : 1,
                borderColor: 'divider',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h2" component="h2">
                  <RouterLink to="/$org/$project" params={{ org: org.slug, project: project.slug }}>
                    <Box component="span" sx={{ fontWeight: 400 }}>
                      {org.name} /{' '}
                    </Box>
                    {project.name}
                  </RouterLink>
                </Typography>
                {latestBuild ? (
                  <Box sx={{ mt: 0.5 }}>
                    <BuildMeta build={latestBuild} />
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    No builds yet
                  </Typography>
                )}
              </Box>
              {latestBuild ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <CountsSummary counts={latestBuild.counts} includeUnchanged={false} />
                  <BuildStateLabel build={latestBuild} size="small" />
                </Box>
              ) : null}
            </Box>
          ))}
        </Box>
      )}
    </PageLayout>
  )
}

import { Box, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { createLink } from '@tanstack/react-router'

import { projectsQuery } from '../api.ts'
import {
  Code,
  CountsLine,
  ErrorAlert,
  Loading,
  RefLine,
  StatusChip,
  TimeAgo,
} from '../components.tsx'

const CardLink = createLink(CardActionArea)

export function ProjectsPage() {
  const { data, error } = useQuery(projectsQuery())
  if (error) return <ErrorAlert error={error} />
  if (!data) return <Loading />

  if (data.projects.length === 0) {
    return (
      <Box sx={{ maxWidth: 640 }}>
        <Typography variant="h1" gutterBottom>
          No projects yet
        </Typography>
        <Typography>Create one on the server:</Typography>
        <Code>
          {
            'circi admin org create --name "Acme"\ncirci admin project create --org acme --name "Web app"'
          }
        </Code>
      </Box>
    )
  }

  return (
    <>
      <Typography variant="h1" gutterBottom>
        Projects
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        }}
      >
        {data.projects.map(({ org, project, latestBuild }) => (
          <Card key={`${org.slug}/${project.slug}`}>
            <CardLink
              to="/$org/$project"
              params={{ org: org.slug, project: project.slug }}
              sx={{ height: '100%' }}
            >
              <CardContent>
                <Typography variant="h2" gutterBottom>
                  <Typography component="span" color="text.secondary" sx={{ fontWeight: 400 }}>
                    {org.name} /{' '}
                  </Typography>
                  {project.name}
                </Typography>
                {latestBuild ? (
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <StatusChip build={latestBuild} />
                      <Typography variant="body2" color="text.secondary">
                        #{latestBuild.number} · <TimeAgo iso={latestBuild.createdAt} />
                      </Typography>
                    </Stack>
                    <RefLine build={latestBuild} />
                    <CountsLine counts={latestBuild.counts} />
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No builds yet
                  </Typography>
                )}
              </CardContent>
            </CardLink>
          </Card>
        ))}
      </Box>
    </>
  )
}

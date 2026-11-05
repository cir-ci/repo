import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined'
import { Alert, Box, Button, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

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
import { PageHeader } from '../../primitives/PageHeader.tsx'
import { PageLayout } from '../../primitives/PageLayout.tsx'
import { capabilitiesQuery, projectsQuery } from './api.ts'
import { NewOrganizationDialog, NewProjectDialog } from './CreateDialogs.tsx'

export function ProjectsPage() {
  useDocumentTitle('Projects')
  const { data, error, refetch } = useQuery(projectsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const [dialog, setDialog] = useState<'project' | 'organization' | null>(null)
  const canCreateProject = (caps?.manageableOrganizations.length ?? 0) > 0
  const canCreateOrg = caps?.canCreateOrganization === true

  return (
    <PageLayout
      header={
        <PageHeader
          title="Projects"
          description="Each project receives screenshot builds from one repository’s CI."
          actions={
            <>
              {canCreateOrg ? (
                <Button size="small" onClick={() => setDialog('organization')}>
                  New organization
                </Button>
              ) : null}
              {canCreateProject ? (
                <Button size="small" variant="contained" onClick={() => setDialog('project')}>
                  New project
                </Button>
              ) : null}
            </>
          }
        />
      }
    >
      {caps?.refusingOrganizations.map((o) => (
        <Alert key={o.name} severity="info" sx={{ mb: 2 }}>
          {o.name} only shows its projects to people who signed in with{' '}
          {o.accepts.length > 0
            ? o.accepts.map((m) => (m === 'email' ? 'an email code' : 'a password')).join(' or ')
            : 'another method'}
          . Sign out and sign in that way to see them.
        </Alert>
      ))}
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <ListSkeleton rows={3} />
      ) : data.projects.length === 0 ? (
        <Blankslate
          border
          icon={<FolderOpenOutlined />}
          heading="Create your first project"
          description={
            canCreateProject
              ? 'A project holds the screenshot builds of one repository. Create one, then add its CI token to your CI.'
              : canCreateOrg
                ? 'Create an organization first, then add a project to it.'
                : 'You aren’t an owner or admin of any organization yet. Ask one to add you, or to create a project.'
          }
          primaryAction={
            canCreateProject ? (
              <Button variant="contained" onClick={() => setDialog('project')}>
                New project
              </Button>
            ) : canCreateOrg ? (
              <Button variant="contained" onClick={() => setDialog('organization')}>
                New organization
              </Button>
            ) : undefined
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
      <NewOrganizationDialog open={dialog === 'organization'} onClose={() => setDialog(null)} />
      <NewProjectDialog
        open={dialog === 'project'}
        onClose={() => setDialog(null)}
        organizations={caps?.manageableOrganizations ?? []}
      />
    </PageLayout>
  )
}

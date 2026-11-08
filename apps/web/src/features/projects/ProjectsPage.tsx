import {
  Banner,
  Button,
  Delayed,
  EmptyState,
  FolderOpenIcon,
  ListRow,
  ListSkeleton,
  PanelHeader,
  StatusIcon,
  Text,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { useDocumentTitle } from '../../lib/document-title.ts'
import { ErrorState } from '../../lib/ErrorState.tsx'
import { useClientLink } from '../../lib/use-client-link.ts'
import { buildState } from '../builds/build-state.ts'
import { BuildMeta } from '../builds/BuildMeta.tsx'
import { CountsSummary } from '../builds/CountsSummary.tsx'
import { shotReview } from '../builds/diff-status.ts'
import { capabilitiesQuery, projectsQuery } from './api.ts'
import { NewOrganizationDialog, NewProjectDialog } from './CreateDialogs.tsx'
import { useLoadingAnnouncement } from './loading.ts'
import { ProjectBreadcrumbs } from './ProjectBreadcrumbs.tsx'

import styles from './ProjectsPage.module.css'

export function ProjectsPage() {
  useDocumentTitle('Projects')
  const clientLink = useClientLink()
  const { data, error, refetch } = useQuery(projectsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const [dialog, setDialog] = useState<'project' | 'organization' | null>(null)
  useLoadingAnnouncement(!data && !error, 'Loading projects')
  const canCreateProject = (caps?.manageableOrganizations.length ?? 0) > 0
  const canCreateOrg = caps?.canCreateOrganization === true

  return (
    <>
      <PanelHeader
        actions={
          <>
            {canCreateOrg ? (
              <Button size="sm" onClick={() => setDialog('organization')}>
                New organization
              </Button>
            ) : null}
            {canCreateProject ? (
              <Button size="sm" variant="primary" onClick={() => setDialog('project')}>
                New project
              </Button>
            ) : null}
          </>
        }
      >
        <ProjectBreadcrumbs items={[{ label: 'Projects' }]} />
      </PanelHeader>
      <div className={styles['content']}>
        <Text as="p" variant="small" tone="secondary">
          Each project receives screenshot builds from one repository’s CI.
        </Text>
        {caps?.refusingOrganizations.map((o) => (
          <Banner key={o.name}>
            {o.name} only shows its projects to people who signed in with{' '}
            {o.accepts.length > 0
              ? o.accepts.map((m) => (m === 'email' ? 'an email code' : 'a password')).join(' or ')
              : 'another method'}
            . Sign out and sign in that way to see them.
          </Banner>
        ))}
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !data ? (
          <Delayed>
            <ListSkeleton rows={3} />
          </Delayed>
        ) : data.projects.length === 0 ? (
          <EmptyState
            icon={<FolderOpenIcon size={32} />}
            title="Create your first project"
            action={
              canCreateProject ? (
                <Button variant="primary" onClick={() => setDialog('project')}>
                  New project
                </Button>
              ) : canCreateOrg ? (
                <Button variant="primary" onClick={() => setDialog('organization')}>
                  New organization
                </Button>
              ) : undefined
            }
          >
            {canCreateProject
              ? 'A project holds the screenshot builds of one repository. Create one, then add its CI token to your CI.'
              : canCreateOrg
                ? 'Create an organization first, then add a project to it.'
                : 'You aren’t an owner or admin of any organization yet. Ask one to add you, or to create a project.'}
          </EmptyState>
        ) : (
          <ul aria-label="Projects" className={styles['list']}>
            {data.projects.map(({ org, project, latestBuild }) => {
              const state = latestBuild ? buildState(latestBuild) : null
              return (
                <li key={`${org.slug}/${project.slug}`}>
                  <ListRow
                    className={styles['row']}
                    {...clientLink({
                      to: '/$org/$project',
                      params: { org: org.slug, project: project.slug },
                    })}
                    leading={
                      state ? (
                        <StatusIcon status={state.status} label={state.label} />
                      ) : (
                        <StatusIcon status="neutral" label="No builds yet" />
                      )
                    }
                    trailing={
                      latestBuild ? (
                        <span className={styles['trailing']}>
                          <CountsSummary
                            counts={latestBuild.counts}
                            review={shotReview(latestBuild)}
                            includeUnchanged={false}
                          />
                        </span>
                      ) : undefined
                    }
                  >
                    <span className={styles['title']}>
                      <span className={styles['org']}>{org.name} / </span>
                      {project.name}
                    </span>
                    <div className={styles['meta']}>
                      {latestBuild ? (
                        <BuildMeta build={latestBuild} />
                      ) : (
                        <Text variant="small" tone="secondary">
                          No builds yet
                        </Text>
                      )}
                    </div>
                  </ListRow>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <NewOrganizationDialog open={dialog === 'organization'} onClose={() => setDialog(null)} />
      <NewProjectDialog
        open={dialog === 'project'}
        onClose={() => setDialog(null)}
        organizations={caps?.manageableOrganizations ?? []}
      />
    </>
  )
}

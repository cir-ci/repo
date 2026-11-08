import { Banner, Delayed, ListSkeleton, PanelHeader } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { useDocumentTitle } from '../../lib/document-title.ts'
import { ErrorState } from '../../lib/ErrorState.tsx'
import { projectsQuery, settingsQuery } from './api.ts'
import { CiToken } from './CiTokenSection.tsx'
import { GithubLink } from './GithubSection.tsx'
import { useLoadingAnnouncement } from './loading.ts'
import { ProjectBreadcrumbs } from './ProjectBreadcrumbs.tsx'
import { SettingsForm } from './SettingsForm.tsx'
import { Webhooks } from './WebhooksSection.tsx'

import styles from './ProjectSettingsPage.module.css'

/** A project's settings, and where it sends webhooks. Owners and admins edit; members look. */
export function ProjectSettingsPage() {
  const { org, project } = useParams({ from: '/$org/$project/settings' })
  const { data, error, refetch } = useQuery(settingsQuery(org, project))
  // The settings don't carry the organization's name, but the projects list (cached by the sidebar) does.
  const { data: overview } = useQuery(projectsQuery())
  const orgName = overview?.projects.find((p) => p.org.slug === org)?.org.name ?? org
  useDocumentTitle('Settings', project)
  useLoadingAnnouncement(!data && !error, 'Loading settings')

  return (
    <>
      <PanelHeader>
        <ProjectBreadcrumbs
          items={[
            { label: 'Projects', link: { to: '/' } },
            { label: orgName },
            {
              label: data?.settings.name ?? project,
              link: { to: '/$org/$project', params: { org, project } },
            },
            { label: 'Settings' },
          ]}
        />
      </PanelHeader>
      <div className={styles['content']}>
        {error ? (
          <ErrorState
            error={error}
            onRetry={() => void refetch()}
            notFound="This project doesn’t exist"
          />
        ) : !data ? (
          <Delayed>
            <ListSkeleton />
          </Delayed>
        ) : (
          <>
            {data.canManage ? null : (
              <Banner>Only owners and admins can change these settings.</Banner>
            )}
            <SettingsForm
              // A fresh form whenever the saved values change, so it never shows stale input.
              key={JSON.stringify(data.settings)}
              org={org}
              project={project}
              settings={data.settings}
              canManage={data.canManage}
              orgFlakyBlocksMerge={data.org.flakyBlocksMerge}
              sitesConfigured={data.sitesConfigured}
            />
            {data.canManage ? <CiToken org={org} project={project} /> : null}
            {data.github.configured ? (
              <GithubLink
                org={org}
                project={project}
                github={data.github}
                canManage={data.canManage}
              />
            ) : null}
            <Webhooks
              org={org}
              project={project}
              hooks={data.webhooks}
              events={data.webhookEvents}
              canManage={data.canManage}
            />
          </>
        )}
      </div>
    </>
  )
}

import { Banner, Delayed, ListSkeleton, PanelHeader } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { useDocumentTitle } from '#lib/document-title.ts'
import { ErrorState } from '#lib/ErrorState.tsx'

import { teamsQuery, settingsQuery } from './api.ts'
import { CiToken } from './CiTokenSection.tsx'
import { GitAttentionBanner } from './GitAttentionBanner.tsx'
import { useLoadingAnnouncement } from './loading.ts'
import { SettingsForm } from './SettingsForm.tsx'
import { TeamBreadcrumbs } from './TeamBreadcrumbs.tsx'
import { Webhooks } from './WebhooksSection.tsx'

import styles from './TeamSettingsPage.module.css'

/** A team's settings, and where it sends webhooks. Owners and admins edit; members look. */
export function TeamSettingsPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team/settings' })
  const { data, error, refetch } = useQuery(settingsQuery(workspace, team))
  // The settings don't carry the workspace's name, but the teams list (cached by the sidebar) does.
  const { data: overview } = useQuery(teamsQuery())
  const workspaceName =
    overview?.teams.find((p) => p.workspace.slug === workspace)?.workspace.name ?? workspace
  useDocumentTitle('Settings', team)
  useLoadingAnnouncement(!data && !error, 'Loading settings')

  return (
    <>
      <PanelHeader>
        <TeamBreadcrumbs
          items={[
            { label: 'Teams', link: { to: '/' } },
            { label: workspaceName },
            {
              label: data?.settings.name ?? team,
              link: { to: '/$workspace/$team', params: { workspace, team } },
            },
            { label: 'Settings' },
          ]}
        />
      </PanelHeader>
      <div className={styles.content}>
        {error ? (
          <ErrorState
            error={error}
            onRetry={() => void refetch()}
            notFound="This team doesn’t exist"
          />
        ) : !data ? (
          <Delayed>
            <ListSkeleton />
          </Delayed>
        ) : (
          <>
            <GitAttentionBanner attention={data.github.link?.attention} />
            {data.canManage ? null : (
              <Banner>Only owners and admins can change these settings.</Banner>
            )}
            <SettingsForm
              // A fresh form whenever the saved values change, so it never shows stale input.
              key={JSON.stringify(data.settings)}
              workspace={workspace}
              team={team}
              settings={data.settings}
              canManage={data.canManage}
              workspaceFlakyBlocksMerge={data.workspace.flakyBlocksMerge}
              sitesConfigured={data.sitesConfigured}
            />
            {data.canManage ? <CiToken workspace={workspace} team={team} /> : null}
            <Webhooks
              workspace={workspace}
              team={team}
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

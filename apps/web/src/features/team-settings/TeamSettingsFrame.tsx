import type { Team } from '@circi/api'
import { Banner, Delayed, ListSkeleton } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { useLoadingAnnouncement } from '#features/builds/list/loading.ts'
import { settingsQuery, teamsQuery } from '#features/teams/api/index.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { PageHeading, teamCrumb, workspaceCrumb } from '#lib/PageHeading.tsx'

import styles from './TeamSettingsFrame.module.css'

/**
 * What every team settings page shares: the breadcrumb (Teams, workspace, team, Settings, this
 * page), one column, the team's settings loaded once (the other pages read the same cache), its
 * loading and error states, and a note for people who may look but not change.
 */
export function TeamSettingsFrame({
  workspace,
  team,
  page,
  width = 'form',
  readOnlyNote = 'Only owners and admins can change these settings.',
  children,
}: TeamSettingsFrame.Props) {
  const { data, error, refetch } = useQuery(settingsQuery(workspace, team))
  // The settings don't carry the workspace's name, but the teams list (cached by the sidebar) does.
  const { data: overview } = useQuery(teamsQuery())
  const found = overview?.teams.find((p) => p.workspace.slug === workspace)
  const workspaceName = found?.workspace.name ?? workspace
  const teamName = data?.settings.name ?? team
  useDocumentTitle(page, team)
  useLoadingAnnouncement(!data && !error, `Loading ${page.toLowerCase()}`)

  return (
    <>
      <PageHeading
        crumbs={[
          { label: 'Teams', link: { to: '/' } },
          workspaceCrumb({ slug: workspace, name: workspaceName }),
          teamCrumb(workspace, { slug: team, name: teamName }),
          ...(page === 'Settings' ? [] : [{ label: 'Settings' }]),
        ]}
        title={page}
      />
      <div className={styles.content} data-width={width}>
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
            {data.canManage || !readOnlyNote ? null : <Banner>{readOnlyNote}</Banner>}
            {children(data, teamName)}
          </>
        )}
      </div>
    </>
  )
}

export namespace TeamSettingsFrame {
  export interface Props {
    workspace: string
    team: string
    /** This page's name: the last crumb and the start of the tab title. */
    page: string
    /** The column's width: 720 for forms, 1040 for the ignore regions workbench. */
    width?: 'form' | 'wide'
    /** Shown to people who can't change things; `false` for a page where they can. */
    readOnlyNote?: string | false
    children: (settings: Team.SettingsResponse, teamName: string) => ReactNode
  }
}

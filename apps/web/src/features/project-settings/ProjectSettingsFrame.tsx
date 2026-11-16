import type { Project } from '@circi/api'
import { Avatar, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Navigate, type NavigateOptions } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { useLoadingAnnouncement } from '#features/builds/list/loading.ts'
import { settingsQuery, projectsQuery } from '#features/projects/api/index.ts'
import { memberCountLabel } from '#features/projects/AvatarStack.tsx'
import {
  settingsCrumbsFor,
  projectSettingsCrumb,
  projectsSettingsCrumb,
  workspaceSettingsCrumb,
} from '#lib/crumbs.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { PageFrame } from '#lib/PageFrame.tsx'

import { SettingsBackLink } from './SettingsBackLink.tsx'

import styles from './ProjectSettingsHub.module.css'

/**
 * What every project settings page shares: the breadcrumb (Workspace, Settings, Projects, the project, the
 * page: see `lib/crumbs.ts`), one column (settings has one way back, the sidebar's; a page below
 * another settings page, `back`, is the one in-page link), the project's settings loaded once (the other pages read the same cache),
 * its loading and error states, and, for the pages only owners and admins may use, a redirect to
 * the project's settings hub for everyone else (settings is a closed area: never out to the app)
 * (`managersOnly={false}` keeps a page that members may read).
 *
 * Without a `page` it is the project's hub (`ProjectSettingsHubPage`): the project's name is its title, with
 * its tile and member count above the rows.
 */
export function ProjectSettingsFrame({
  workspace,
  project,
  page,
  width = 'default',
  managersOnly = true,
  back,
  find,
  actions,
  children,
}: ProjectSettingsFrame.Props) {
  const { data, error, refetch } = useQuery(settingsQuery(workspace, project))
  // The settings carry neither the workspace's name nor the member count, but the projects list (cached by the sidebar) does.
  const { data: overview } = useQuery(projectsQuery())
  const inWorkspace = overview?.projects.filter((p) => p.workspace.slug === workspace)
  const found = inWorkspace?.find((p) => p.project.slug === project)
  const workspaceName = inWorkspace?.[0]?.workspace.name ?? workspace
  const projectName = data?.settings.name ?? project
  // The tile follows the project's appearance; until the settings say, the default colour.
  const appearance: Partial<Project.Appearance> | undefined = data?.appearance
  useDocumentTitle(page ?? projectName, page ? project : undefined)
  useLoadingAnnouncement(!data && !error, `Loading ${(page ?? projectName).toLowerCase()}`)

  return (
    <PageFrame
      crumbs={settingsCrumbsFor({ slug: workspace, name: workspaceName }, [
        workspaceSettingsCrumb(workspace),
        projectsSettingsCrumb(workspace),
        ...(page ? [projectSettingsCrumb(workspace, project, projectName)] : []),
      ])}
      title={page ?? projectName}
      {...(find ? { find } : {})}
      {...(actions ? { actions } : {})}
      width={width}
      loading={!data}
      error={error}
      onRetry={() => void refetch()}
      notFound="This project doesn't exist"
      forbidden={
        managersOnly && data && !data.canManage ? (
          <Navigate to="/$workspace/$project/settings" params={{ workspace, project }} replace />
        ) : null
      }
    >
      {data ? (
        <>
          {back || !page ? (
            <div className={styles.head}>
              {back ? <SettingsBackLink label={back.label} link={back.link} /> : null}
              {page ? null : (
                <div className={styles.identity}>
                  <Avatar
                    type="project"
                    aria-hidden
                    slug={project}
                    name={projectName}
                    color={appearance?.color ?? 'slate'}
                    icon={appearance?.icon ?? null}
                    size={40}
                  />
                  <div className={styles.names}>
                    <span className={styles.name}>{projectName}</span>
                    {found ? (
                      <Text tone="tertiary" variant="small">
                        {memberCountLabel(found.project.memberCount)}
                      </Text>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ) : null}
          {children(data, projectName)}
        </>
      ) : null}
    </PageFrame>
  )
}

export namespace ProjectSettingsFrame {
  export interface Props {
    workspace: string
    project: string
    /** This page's name: its title and the last crumb. Without one the frame is the project's hub, titled with the project's name. */
    page?: string
    /** The column's width: 720 by default, 1040 for the ignore regions workbench. */
    width?: 'default' | 'wide'
    /** Default: people who can't change the project's settings are sent to its settings hub. `false` for a page members may read. */
    managersOnly?: boolean
    /** A page one level below another settings page (an ignore region's screenshot) links up to that page; other pages have no in-page link. */
    back?: { label: string; link: NavigateOptions }
    /** The page's find field and main button, in the header bar. */
    find?: ReactNode
    actions?: ReactNode
    children: (settings: Project.SettingsResponse, projectName: string) => ReactNode
  }
}

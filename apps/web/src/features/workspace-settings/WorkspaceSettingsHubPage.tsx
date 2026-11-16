import type { Workspace } from '@circi/api'
import {
  Avatar,
  Button,
  BlocksIcon,
  DatabaseIcon,
  EmptyState,
  LayersIcon,
  SettingsLinkRow,
  SettingsSection,
  ShieldCheckIcon,
  SlidersIcon,
  Text,
  UsersIcon,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { useJoinWorkspace, workspacesQuery } from '#features/instance/api/admin.ts'
import { integrationsQuery } from '#features/integrations/api/index.ts'
import { workspaceAuthQuery } from '#features/members/api.ts'
import { instanceCrumb, workspacesCrumb } from '#lib/crumbs.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { PageFrame } from '#lib/PageFrame.tsx'
import { toast } from '#lib/toast.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import { formatBytes, workspaceGeneralQuery } from './api.ts'
import { DeletedWorkspaceSection } from './DeletedWorkspaceSection.tsx'
import { hubSubtitle, type WorkspaceHubKey, workspaceHubGroups } from './hub-model.ts'

import styles from './WorkspaceSettingsHub.module.css'

const PATHS = {
  general: '/workspaces/$workspace/settings/general',
  members: '/workspaces/$workspace/settings/members',
  projects: '/workspaces/$workspace/settings/projects',
  'sign-in': '/workspaces/$workspace/settings/sign-in',
  integrations: '/workspaces/$workspace/settings/integrations',
  storage: '/workspaces/$workspace/settings/storage',
} as const satisfies Record<WorkspaceHubKey, string>

const ICONS: Record<WorkspaceHubKey, ReactNode> = {
  general: <SlidersIcon />,
  members: <UsersIcon />,
  projects: <LayersIcon />,
  'sign-in': <ShieldCheckIcon />,
  integrations: <BlocksIcon />,
  storage: <DatabaseIcon />,
}

/** How many of the sign-in methods the instance offers the workspace has switched on. */
function methodCount(auth: Workspace.Auth): number {
  const { settings, instance } = auth
  return [
    instance.password && settings.passwordLoginEnabled,
    instance.email && settings.emailLoginEnabled,
    instance.github && settings.signinGithub,
    instance.google && settings.signinGoogle,
  ].filter(Boolean).length
}

/**
 * A workspace's settings hub, for instance admins (the
 * project hub's sibling): the workspace's name and size, then one row for each settings page, in
 * groups (Workspace, Access, Connections, Data), each with a one-line summary. The counts and
 * the storage come from the instance's workspaces list (the same list the
 * sidebar lists), the sign-in methods and integrations from the queries those pages read; those two are
 * only fetched for someone who may open the pages. An instance admin who isn't in the workspace sees why
 * there are no rows and a Join workspace button (they join as an admin). A deleted workspace has no rows either: it
 * offers Restore and Delete permanently. "‹ Workspaces" goes back to the All workspaces list
 * (where New workspace is).
 */
export function WorkspaceSettingsHubPage({ workspace }: WorkspaceSettingsHubPage.Props) {
  const clientLink = useClientLink()
  const join = useJoinWorkspace()
  const { data, error, refetch } = useQuery(workspacesQuery())
  const found = data?.workspaces.find((w) => w.slug === workspace)
  const member = found?.youAreMember === true && !found.deletedAt
  const general = useQuery({ ...workspaceGeneralQuery(workspace), enabled: member })
  const manage = member && general.data?.canManage === true
  const auth = useQuery({ ...workspaceAuthQuery(workspace), enabled: manage })
  const integrations = useQuery({ ...integrationsQuery(workspace), enabled: manage })
  const name = found?.name ?? workspace
  useDocumentTitle(name, 'Settings')

  const groups = found
    ? workspaceHubGroups({
        member,
        canManage: member ? general.data?.canManage : undefined,
        slug: found.slug,
        memberCount: found.memberCount,
        projectCount: found.projectCount,
        storage: formatBytes(found.storageBytes),
        signInMethods: auth.data ? methodCount(auth.data) : undefined,
        integrationCount: integrations.data?.integrations.length,
      })
    : []

  return (
    <PageFrame
      crumbs={[instanceCrumb(), workspacesCrumb()]}
      title={name}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      forbidden={
        data && !found ? (
          <EmptyState size="section" title="This workspace doesn't exist">
            It may have been deleted, or the link may be wrong.
          </EmptyState>
        ) : null
      }
    >
      {found ? (
        <>
          <div className={styles.head}>
            <div className={styles.identity}>
              <Avatar
                type="workspace"
                aria-hidden
                slug={found.slug}
                name={found.name}
                picture={found.picture}
                size={40}
              />
              <div className={styles.names}>
                <span className={styles.name}>{found.name}</span>
                <Text tone="tertiary" variant="small">
                  {hubSubtitle(found.memberCount, found.projectCount)}
                </Text>
              </div>
            </div>
          </div>
          {found.deletedAt ? (
            <DeletedWorkspaceSection workspace={found} />
          ) : member ? (
            groups.map((group) => (
              <SettingsSection key={group.title} title={group.title}>
                {group.rows.map((row) => (
                  <SettingsLinkRow
                    key={row.key}
                    icon={ICONS[row.key]}
                    label={row.label}
                    detail={row.detail}
                    value={row.value}
                    {...clientLink({ to: PATHS[row.key], params: { workspace } })}
                  />
                ))}
              </SettingsSection>
            ))
          ) : (
            <EmptyState
              size="section"
              title="You're not a member of this workspace"
              action={
                <Button
                  variant="primary"
                  loading={join.isPending}
                  onClick={() =>
                    join.mutate(found.id, { onSuccess: () => toast(`Joined ${found.name}`) })
                  }
                >
                  Join workspace
                </Button>
              }
            />
          )}
        </>
      ) : null}
    </PageFrame>
  )
}

export namespace WorkspaceSettingsHubPage {
  export interface Props {
    workspace: string
  }
}

import {
  ActivityIcon,
  BuildingIcon,
  ServerIcon,
  SettingsLinkRow,
  SettingsSection,
  Text,
  UserPlusIcon,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { useDocumentTitle } from '#lib/document-title.ts'
import { PageFrame } from '#lib/PageFrame.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import { InstanceAdminsOnly } from './AdminFrame.tsx'
import { accountsQuery, isForbidden, settingsQuery, workspacesQuery } from './api/admin.ts'
import { instanceHubGroups, type InstanceHubKey, instanceHubTitle } from './hub-model.ts'

import styles from './InstanceHub.module.css'

const PATHS = {
  accounts: '/instance/accounts',
  workspaces: '/instance/workspaces',
  settings: '/instance/settings',
  health: '/instance/health',
} as const satisfies Record<InstanceHubKey, string>

const ICONS: Record<InstanceHubKey, ReactNode> = {
  accounts: <UserPlusIcon />,
  workspaces: <BuildingIcon />,
  settings: <ServerIcon />,
  health: <ActivityIcon />,
}

/**
 * The Instance hub (instance admins; the workspace and team hubs' sibling): the instance's tile and
 * name ("Instance", it has none of its own) with its address beneath, then one row for each
 * Instance page in groups (People, Workspaces, Server), each with a one-line summary. The account
 * total, the workspace count and the public URL come from the queries those pages read (the
 * accounts list's first page, the workspaces list the sidebar already holds, Instance settings).
 * Health has no summary: the doctor's checks ask other hosts, so they run only on its page.
 */
export function InstanceHubPage() {
  const clientLink = useClientLink()
  useDocumentTitle('Instance', 'Settings')
  const settings = useQuery(settingsQuery())
  const accounts = useQuery(accountsQuery({ q: '', page: 1 }))
  const workspaces = useQuery(workspacesQuery())
  const publicUrl = settings.data?.publicUrl
  const { name, subtitle } = instanceHubTitle(publicUrl)
  const groups = instanceHubGroups({
    accountCount: accounts.data?.total,
    workspaceCount: workspaces.data?.workspaces.filter((w) => !w.deletedAt).length,
    publicUrl,
  })

  return (
    <PageFrame
      crumbs={[]}
      title={name}
      loading={!settings.data && !settings.error}
      error={settings.error}
      onRetry={() => void settings.refetch()}
      forbidden={isForbidden(settings.error) ? <InstanceAdminsOnly /> : null}
    >
      <div className={styles.head}>
        <div className={styles.identity}>
          <span className={styles.tile} aria-hidden>
            <ServerIcon size={22} />
          </span>
          <div className={styles.names}>
            <span className={styles.name}>{name}</span>
            {subtitle ? (
              <Text tone="tertiary" variant="small">
                {subtitle}
              </Text>
            ) : null}
          </div>
        </div>
      </div>
      {groups.map((group) => (
        <SettingsSection key={group.title} title={group.title}>
          {group.rows.map((row) => (
            <SettingsLinkRow
              key={row.key}
              icon={ICONS[row.key]}
              label={row.label}
              detail={row.detail}
              value={row.value}
              {...clientLink({ to: PATHS[row.key] })}
            />
          ))}
        </SettingsSection>
      ))}
    </PageFrame>
  )
}

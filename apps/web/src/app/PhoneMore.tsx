import {
  BuildingIcon,
  GlobeIcon,
  ImageIcon,
  InsightsIcon,
  ListFilterIcon,
  Sheet,
  UserIcon,
} from '@circi/ui'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { MouseEvent, ReactNode } from 'react'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'

import { phoneTeam, pinnedViews, workspaceSettingsPath } from './shell-model.ts'

import styles from './PhoneMore.module.css'

/**
 * The phone's More sheet (the last bottom tab; canvas: Phone, Insights, Teams, search and
 * navigation): what the four tabs don't hold. Insights, then the open (or first) team's Baselines
 * and Sites, the pinned views, and the settings entry points: the workspace's and the account's.
 * Rows are 48px links; choosing one closes the sheet.
 */
export function PhoneMore() {
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const open = useOverlayStore((s) => s.moreOpen)
  const setOpen = useOverlayStore((s) => s.setMoreOpen)
  const { workspace } = useWorkspaces(useChosenWorkspace())
  const { data: model } = useSidebarModel(workspace?.slug)
  const team = phoneTeam(model?.teams, params.team)
  const ws = workspace ? encodeURIComponent(workspace.slug) : undefined
  const teamBase = ws && team ? `/${ws}/${encodeURIComponent(team.slug)}` : undefined
  const views = pinnedViews(model?.views)

  const go = (href: string) => {
    setOpen(false)
    void navigate({ href })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen} title="More">
      <nav aria-label="More" className={styles.list}>
        {ws ? (
          <MoreRow onGo={go} href={`/workspaces/${ws}/insights`} icon={<InsightsIcon />}>
            Insights
          </MoreRow>
        ) : null}
        {teamBase ? (
          <MoreRow onGo={go} href={`${teamBase}/baselines`} icon={<ImageIcon />}>
            Baselines
          </MoreRow>
        ) : null}
        {teamBase && (team?.siteCount ?? 0) > 0 ? (
          <MoreRow onGo={go} href={`${teamBase}/sites`} icon={<GlobeIcon />}>
            Sites
          </MoreRow>
        ) : null}
        {ws
          ? views.map((view) => (
              <MoreRow
                onGo={go}
                key={view.id}
                href={`/workspaces/${ws}/views/${encodeURIComponent(view.id)}`}
                icon={<ListFilterIcon />}
              >
                {view.name}
              </MoreRow>
            ))
          : null}
        <div className={styles.rule} role="presentation" />
        {workspace ? (
          <MoreRow
            onGo={go}
            href={workspaceSettingsPath(workspace.slug, model?.canManage)}
            icon={<BuildingIcon />}
          >
            {`${workspace.name} settings`}
          </MoreRow>
        ) : null}
        <MoreRow onGo={go} href="/account/profile" icon={<UserIcon />}>
          Account settings
        </MoreRow>
      </nav>
    </Sheet>
  )
}

function MoreRow({ href, icon, children, onGo }: MoreRow.Props) {
  const go = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    onGo(href)
  }
  return (
    <a className={styles.row} href={href} onClick={go}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      {children}
    </a>
  )
}

namespace MoreRow {
  export interface Props {
    href: string
    icon: ReactNode
    children: ReactNode
    onGo: (href: string) => void
  }
}

import {
  BuildingIcon,
  GlobeIcon,
  ImageIcon,
  InsightsIcon,
  ListFilterIcon,
  LogOutIcon,
  Sheet,
  UserIcon,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'

import { useSignOut } from '#features/auth/use-sign-out.ts'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { useSwitchWorkspace } from '#features/sidebar/use-switch-workspace.ts'
import { useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { WorkspaceSwitcher } from '#features/sidebar/WorkspaceSwitcher.tsx'
import { capabilitiesQuery } from '#features/teams/api/index.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'

import { SheetRow } from './PhoneRow.tsx'
import { phoneTeam, pinnedViews, workspaceSettingsPath } from './shell-model.ts'

import styles from './PhoneMore.module.css'

/**
 * The phone's More sheet (the last bottom tab; canvas: Phone, Insights, Teams, search and
 * navigation), what the tabs don't reach: the workspace switcher at the top, then Insights, the
 * open (or first) team's Baselines and Sites, the pinned views, and the settings entry points: the
 * workspace's and the account's, with Sign out. Teams live in the Teams tab's sheet. Rows are
 * 48px links; choosing one closes the sheet.
 */
export function PhoneMore() {
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const open = useOverlayStore((s) => s.moreOpen)
  const setOpen = useOverlayStore((s) => s.setMoreOpen)
  const setNewWorkspaceOpen = useOverlayStore((s) => s.setNewWorkspaceOpen)
  const { workspaces, workspace } = useWorkspaces(useChosenWorkspace())
  const { data: model } = useSidebarModel(workspace?.slug)
  const { data: caps } = useQuery(capabilitiesQuery())
  const switchWorkspace = useSwitchWorkspace()
  const signOut = useSignOut()
  const team = phoneTeam(model?.teams, params.team)
  const ws = workspace ? encodeURIComponent(workspace.slug) : undefined
  const teamBase = ws && team ? `/${ws}/${encodeURIComponent(team.slug)}` : undefined
  const views = pinnedViews(model?.views)

  // Any page change (a menu item that navigates, a link) closes the sheet.
  useEffect(() => {
    if (pathname) setOpen(false)
  }, [pathname, setOpen])

  const go = (href: string) => {
    setOpen(false)
    void navigate({ href })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen} title="More" size="tall">
      <div className={styles.switcher}>
        <WorkspaceSwitcher
          workspaces={workspaces}
          current={workspace}
          onSelect={switchWorkspace}
          canManage={model?.canManage}
          {...(caps?.canCreateWorkspace
            ? {
                onCreate: () => {
                  setOpen(false)
                  setNewWorkspaceOpen(true)
                },
              }
            : {})}
        />
      </div>
      <nav aria-label="More" className={styles.list}>
        {ws ? (
          <SheetRow onGo={go} href={`/workspaces/${ws}/insights`} icon={<InsightsIcon />}>
            Insights
          </SheetRow>
        ) : null}
        {teamBase ? (
          <SheetRow onGo={go} href={`${teamBase}/baselines`} icon={<ImageIcon />}>
            Baselines
          </SheetRow>
        ) : null}
        {teamBase && (team?.siteCount ?? 0) > 0 ? (
          <SheetRow onGo={go} href={`${teamBase}/sites`} icon={<GlobeIcon />}>
            Sites
          </SheetRow>
        ) : null}
        {ws
          ? views.map((view) => (
              <SheetRow
                onGo={go}
                key={view.id}
                href={`/workspaces/${ws}/views/${encodeURIComponent(view.id)}`}
                icon={<ListFilterIcon />}
              >
                {view.name}
              </SheetRow>
            ))
          : null}
        <div className={styles.rule} role="presentation" />
        {workspace ? (
          <SheetRow
            onGo={go}
            href={workspaceSettingsPath(workspace.slug, model?.canManage)}
            icon={<BuildingIcon />}
          >
            {`${workspace.name} settings`}
          </SheetRow>
        ) : null}
        <SheetRow onGo={go} href="/account/profile" icon={<UserIcon />}>
          Account settings
        </SheetRow>
        <button
          type="button"
          className={styles.row}
          onClick={() => {
            setOpen(false)
            void signOut()
          }}
        >
          <span className={styles.icon} aria-hidden="true">
            <LogOutIcon />
          </span>
          Sign out
        </button>
      </nav>
    </Sheet>
  )
}

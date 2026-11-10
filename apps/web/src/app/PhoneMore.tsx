import {
  Avatar,
  BuildingIcon,
  GlobeIcon,
  ImageIcon,
  InsightsIcon,
  ListFilterIcon,
  LogOutIcon,
  PinIcon,
  Sheet,
  UserIcon,
  visuallyHidden,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router'
import { type MouseEvent, type ReactNode, useEffect } from 'react'

import { useSignOut } from '#features/auth/use-sign-out.ts'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { useSwitchWorkspace } from '#features/sidebar/use-switch-workspace.ts'
import { useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { WorkspaceSwitcher } from '#features/sidebar/WorkspaceSwitcher.tsx'
import { capabilitiesQuery } from '#features/teams/api/index.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'

import {
  countOrUndefined,
  phoneTeam,
  pinnedViews,
  sidebarTeams,
  workspaceSettingsPath,
} from './shell-model.ts'

import styles from './PhoneMore.module.css'

/** How many teams the More sheet lists before "All teams" (the Teams tab lists every one). */
const PHONE_TEAM_LIMIT = 5

/**
 * The phone's More sheet (the last bottom tab; canvas: Phone, Insights, Teams, search and
 * navigation), the phone's replacement for the sidebar: the workspace switcher at the top, the
 * workspace's teams (pinned first, with their triage counts; "All teams" opens the Teams tab when
 * there are more), then Insights, the open (or first) team's Baselines and Sites, the pinned
 * views, and the settings entry points: the workspace's and the account's, with Sign out. Rows are
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
  const { shown, total } = sidebarTeams(model?.teams, PHONE_TEAM_LIMIT, params.team)

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
        {ws && shown.length > 0 ? (
          <>
            <div className={styles.heading}>Teams</div>
            {shown.map((t) => {
              const triage = countOrUndefined(t.triage)
              return (
                <MoreRow
                  onGo={go}
                  key={t.slug}
                  href={`/${ws}/${encodeURIComponent(t.slug)}`}
                  icon={
                    <Avatar
                      type="team"
                      aria-hidden
                      slug={t.slug}
                      name={t.name}
                      color={t.color}
                      icon={t.icon}
                      size={20}
                    />
                  }
                  trailing={
                    <>
                      {t.pinned ? <PinIcon size={12} aria-hidden="true" /> : null}
                      {triage === undefined ? null : (
                        <span className={styles.count}>
                          {triage}
                          <span style={visuallyHidden}>
                            {triage === 1 ? ' item to triage' : ' items to triage'}
                          </span>
                        </span>
                      )}
                    </>
                  }
                >
                  {t.name}
                </MoreRow>
              )
            })}
            {total > shown.length ? (
              <MoreRow onGo={go} href="/" more>
                {`All teams (${total})`}
              </MoreRow>
            ) : null}
            <div className={styles.rule} role="presentation" />
          </>
        ) : null}
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

function MoreRow({ href, icon, trailing, more, children, onGo }: MoreRow.Props) {
  const go = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    onGo(href)
  }
  return (
    <a className={styles.row} href={href} onClick={go} data-more={more ? '' : undefined}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.label}>{children}</span>
      {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
    </a>
  )
}

namespace MoreRow {
  export interface Props {
    href: string
    icon?: ReactNode
    /** At the right: a pin, a count. */
    trailing?: ReactNode
    /** A pointer to the rest of a list ("All teams"): secondary text, indented under the icons. */
    more?: boolean
    children: ReactNode
    onGo: (href: string) => void
  }
}

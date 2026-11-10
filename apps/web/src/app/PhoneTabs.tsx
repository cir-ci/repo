import {
  Avatar,
  BottomBar,
  BottomBarItem,
  FolderOpenIcon,
  InboxIcon,
  ListChecksIcon,
  Menu,
  RowMenuIcon,
  ReviewIcon,
} from '@circi/ui'
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router'
import type { MouseEvent } from 'react'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { useYourTeams } from '#features/sidebar/use-your-teams.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'

import {
  countOrUndefined,
  currentSection,
  goPath,
  phoneTeam,
  teamSections,
  TEAM_STACK_LIMIT,
  teamsTabLabel,
  type YourTeam,
} from './shell-model.ts'

import styles from './PhoneTabs.module.css'

/**
 * The phone's bottom tab bar (canvas: Phone, inbox to review): Inbox, Teams, Reviews, Triage and
 * More, with the sidebar's counts. Inbox, Reviews and Triage are real links that navigate through
 * the router. Teams shows up to three of your teams' tiles (its label is the team's name when
 * you are in exactly one) and opens a menu of your teams; More opens the sheet
 * of the rest, with the workspace switcher (`PhoneMore`).
 */
export function PhoneTabs() {
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const section = currentSection(pathname)
  const { workspace } = useWorkspaces(useChosenWorkspace())
  const { data: model } = useSidebarModel(workspace?.slug)
  const moreOpen = useOverlayStore((s) => s.moreOpen)
  const setMoreOpen = useOverlayStore((s) => s.setMoreOpen)
  const team = phoneTeam(model?.teams, params.team)
  const teams = useYourTeams()
  const teamsOpen = useOverlayStore((s) => s.teamsOpen)
  const setTeamsOpen = useOverlayStore((s) => s.setTeamsOpen)
  const teamItems = teamMenuItems(teams, (href) => void navigate({ href }))

  const reviews = goPath('reviews', { workspace: workspace?.slug })
  const triage = goPath('triage', {
    workspace: workspace?.slug,
    team: team?.slug,
    teams: model?.teams,
  })
  const inbox = countOrUndefined(model?.inboxUnread)
  const waiting = countOrUndefined(model?.reviews)

  // A plain tap goes through the router (no reload); a new-tab click keeps the link.
  const go = (href: string) => (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    void navigate({ href })
  }

  return (
    <BottomBar label="Pages">
      <BottomBarItem
        icon={<InboxIcon />}
        href="/inbox"
        onClick={go('/inbox')}
        selected={section === 'inbox'}
        {...(inbox === undefined ? {} : { count: inbox, countLabel: 'unread' })}
      >
        Inbox
      </BottomBarItem>
      <Menu
        open={teamsOpen}
        onOpenChange={setTeamsOpen}
        size="md"
        align="center"
        items={teamItems}
        trigger={
          <BottomBarItem
            icon={<TeamStack teams={teams} />}
            selected={
              teamsOpen ||
              section === 'teams' ||
              section === 'builds' ||
              section === 'baselines' ||
              section === 'sites'
            }
          >
            {teamsTabLabel(teams)}
          </BottomBarItem>
        }
      />
      <BottomBarItem
        icon={<ReviewIcon />}
        {...(reviews ? { href: reviews, onClick: go(reviews) } : {})}
        selected={section === 'reviews'}
        {...(waiting === undefined ? {} : { count: waiting, countLabel: 'waiting' })}
      >
        Reviews
      </BottomBarItem>
      <BottomBarItem
        icon={<ListChecksIcon />}
        {...(triage ? { href: triage, onClick: go(triage) } : {})}
        selected={section === 'triage'}
      >
        Triage
      </BottomBarItem>
      <BottomBarItem
        icon={<RowMenuIcon />}
        opensSheet
        selected={moreOpen || section === 'insights'}
        onClick={() => setMoreOpen(true)}
      >
        More
      </BottomBarItem>
    </BottomBar>
  )
}

/** The Teams tab's icon: your first few teams' tiles, overlapping; the folder before any is known. */
function TeamStack({ teams }: { teams: readonly YourTeam[] }) {
  const shown = teams.slice(0, TEAM_STACK_LIMIT)
  if (shown.length === 0) return <FolderOpenIcon />
  return (
    <span className={styles.stack}>
      {shown.map((t) => (
        <span key={`${t.workspace.slug}/${t.slug}`} className={styles.tile}>
          <Avatar
            type="team"
            aria-hidden
            slug={t.slug}
            name={t.name}
            color={t.color}
            icon={t.icon}
            size={20}
          />
        </span>
      ))}
    </span>
  )
}

/**
 * The Teams tab's menu: your teams (pinned first, then by workspace when there are several, a
 * separator between the groups; the workspace's name beside a pinned team from another), each
 * with its triage count, then All teams.
 */
function teamMenuItems(
  teams: readonly YourTeam[],
  go: (href: string) => void,
): (Menu.Item | Menu.Separator)[] {
  const items: (Menu.Item | Menu.Separator)[] = []
  for (const section of teamSections(teams)) {
    if (items.length > 0) items.push({ type: 'separator' })
    for (const t of section.teams) {
      const triage = countOrUndefined(t.triage)
      const note = [section.showWorkspace ? t.workspace.name : undefined, triage]
        .filter((part) => part !== undefined)
        .join(' · ')
      items.push({
        label: t.name,
        icon: (
          <Avatar
            type="team"
            aria-hidden
            slug={t.slug}
            name={t.name}
            color={t.color}
            icon={t.icon}
            size={18}
          />
        ),
        ...(note === '' ? {} : { trailing: note }),
        onSelect: () =>
          go(`/${encodeURIComponent(t.workspace.slug)}/${encodeURIComponent(t.slug)}`),
      })
    }
  }
  if (items.length > 0) items.push({ type: 'separator' })
  items.push({ label: 'All teams', onSelect: () => go('/') })
  return items
}

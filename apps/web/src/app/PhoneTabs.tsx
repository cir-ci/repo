import {
  BottomBar,
  BottomBarItem,
  FolderOpenIcon,
  InboxIcon,
  ListChecksIcon,
  RowMenuIcon,
  ReviewIcon,
} from '@circi/ui'
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router'
import type { MouseEvent } from 'react'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'

import { countOrUndefined, currentSection, goPath, phoneTeam } from './shell-model.ts'

/**
 * The phone's bottom tab bar (canvas: Phone, inbox to review): Inbox, Reviews, Triage, Teams and
 * More, with the sidebar's counts. Workspace and team switching live in the More sheet. Each tab is a
 * real link that navigates through the router; More opens the sheet of the rest (`PhoneMore`).
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
        icon={<FolderOpenIcon />}
        href="/"
        onClick={go('/')}
        selected={section === 'teams' || section === 'builds'}
      >
        Teams
      </BottomBarItem>
      <BottomBarItem
        icon={<RowMenuIcon />}
        opensSheet
        selected={
          moreOpen || section === 'insights' || section === 'baselines' || section === 'sites'
        }
        onClick={() => setMoreOpen(true)}
      >
        More
      </BottomBarItem>
    </BottomBar>
  )
}

import {
  Avatar,
  BottomBar,
  BottomBarItem,
  FolderOpenIcon,
  InboxIcon,
  Menu,
  RowMenuIcon,
  ReviewsIcon,
} from '@circi/ui'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import type { MouseEvent } from 'react'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { useYourProjects } from '#features/sidebar/use-your-projects.ts'
import { ProjectAvatars } from '#lib/ProjectAvatars.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'

import { useMoreMenuItems } from './PhoneMore.tsx'
import {
  countOrUndefined,
  currentSection,
  goPath,
  projectSections,
  PROJECT_STACK_LIMIT,
  projectsTabLabel,
  type YourProject,
} from './shell-model.ts'

/**
 * The phone's bottom tab bar (canvas: Phone, inbox to review): Inbox, Projects, Reviews and More,
 * with the sidebar's counts. Inbox and Reviews are real links that navigate through the router;
 * a project's Triage is one of its page icons beside the find field (`PhoneProjectTabs`). Projects shows up to three of your projects' tiles (its label is the project's name when
 * you are in exactly one) and opens a menu of your projects; More opens a menu of the rest, with the workspaces (`PhoneMore`).
 */
export function PhoneTabs() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const section = currentSection(pathname)
  const { workspace } = useWorkspaces(useChosenWorkspace())
  const { data: model } = useSidebarModel(workspace?.slug)
  const moreOpen = useOverlayStore((s) => s.moreOpen)
  const setMoreOpen = useOverlayStore((s) => s.setMoreOpen)
  const projects = useYourProjects()
  const projectsOpen = useOverlayStore((s) => s.projectsOpen)
  const setProjectsOpen = useOverlayStore((s) => s.setProjectsOpen)
  const moreItems = useMoreMenuItems()
  const projectItems = projectMenuItems(projects, (href) => void navigate({ href }))

  const reviews = goPath('reviews', { workspace: workspace?.slug })
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
        open={projectsOpen}
        onOpenChange={setProjectsOpen}
        size="md"
        align="center"
        items={projectItems}
        trigger={
          <BottomBarItem
            icon={<ProjectStack projects={projects} />}
            selected={
              projectsOpen ||
              section === 'projects' ||
              section === 'builds' ||
              section === 'triage' ||
              section === 'baselines' ||
              section === 'sites'
            }
          >
            {projectsTabLabel(projects)}
          </BottomBarItem>
        }
      />
      <BottomBarItem
        icon={<ReviewsIcon />}
        {...(reviews ? { href: reviews, onClick: go(reviews) } : {})}
        selected={section === 'reviews'}
        {...(waiting === undefined ? {} : { count: waiting, countLabel: 'waiting' })}
      >
        Reviews
      </BottomBarItem>
      <Menu
        open={moreOpen}
        onOpenChange={setMoreOpen}
        size="md"
        align="center"
        items={moreItems}
        trigger={
          <BottomBarItem icon={<RowMenuIcon />} selected={moreOpen || section === 'insights'}>
            More
          </BottomBarItem>
        }
      />
    </BottomBar>
  )
}

/** The Projects tab's icon: your first few projects' tiles, overlapping and still; the folder before any is known. */
function ProjectStack({ projects }: { projects: readonly YourProject[] }) {
  const shown = projects.slice(0, PROJECT_STACK_LIMIT)
  if (shown.length === 0) return <FolderOpenIcon />
  return (
    <ProjectAvatars
      aria-hidden="true"
      projects={shown.map((t) => Object.assign({ id: `${t.workspace.slug}/${t.slug}` }, t))}
      limit={PROJECT_STACK_LIMIT}
      overflow={false}
      overlap={8}
      ring="chrome"
      spread={false}
    />
  )
}

/**
 * The Projects tab's menu: your projects (pinned first, then by workspace when there are several, a
 * separator between the groups; the workspace's name beside a pinned project from another), each
 * with its triage count, then All projects.
 */
function projectMenuItems(
  projects: readonly YourProject[],
  go: (href: string) => void,
): (Menu.Item | Menu.Separator)[] {
  const items: (Menu.Item | Menu.Separator)[] = []
  for (const section of projectSections(projects)) {
    if (items.length > 0) items.push({ type: 'separator' })
    for (const t of section.projects) {
      const triage = countOrUndefined(t.triage)
      const note = [section.showWorkspace ? t.workspace.name : undefined, triage]
        .filter((part) => part !== undefined)
        .join(' · ')
      items.push({
        label: t.name,
        icon: (
          <Avatar
            type="project"
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
  items.push({ label: 'All projects', onSelect: () => go('/') })
  return items
}

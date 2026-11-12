import {
  Avatar,
  InsightsIcon,
  ListFilterIcon,
  LogOutIcon,
  type Menu,
  PlusIcon,
  SettingsIcon,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { useSignOut } from '#features/auth/use-sign-out.ts'
import { capabilitiesQuery } from '#features/projects/api/index.ts'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { useSwitchWorkspace } from '#features/sidebar/use-switch-workspace.ts'
import { useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'

import { pinnedViews, workspaceSettingsPath } from './shell-model.ts'

import styles from './PhoneMore.module.css'

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const

/**
 * The items of the More tab's menu (the last bottom tab, a menu like Projects'; canvas: Phone,
 * Insights, Projects, search and navigation), what the tabs don't reach: the workspaces (the open
 * one marked, choosing another switches as the sidebar's switcher does, and New workspace where
 * allowed), then Insights and the pinned views, then one Settings entry (the workspace's, or the
 * account's without one) and Sign out. Projects live in the Projects tab's menu, and a project's
 * Baselines and Sites in the tabs on its pages. Choosing an item closes the menu.
 */
export function useMoreMenuItems(): (Menu.Item | Menu.Separator | Menu.Content)[] {
  const navigate = useNavigate()
  const setNewWorkspaceOpen = useOverlayStore((s) => s.setNewWorkspaceOpen)
  const { workspaces, workspace } = useWorkspaces(useChosenWorkspace())
  const { data: model } = useSidebarModel(workspace?.slug)
  const { data: caps } = useQuery(capabilitiesQuery())
  const switchWorkspace = useSwitchWorkspace()
  const signOut = useSignOut()
  const ws = workspace ? encodeURIComponent(workspace.slug) : undefined
  const go = (href: string) => void navigate({ href })

  const items: (Menu.Item | Menu.Separator | Menu.Content)[] = []
  if (workspace) {
    items.push({
      type: 'content',
      name: 'Workspaces',
      node: <span className={styles.heading}>Workspaces</span>,
    })
    for (const w of workspaces) {
      items.push({
        label: w.name,
        icon: (
          <Avatar
            type="workspace"
            aria-hidden
            slug={w.slug}
            name={w.name}
            picture={w.picture ?? null}
          />
        ),
        current: w.slug === workspace.slug,
        ...(w.role ? { trailing: ROLE_LABEL[w.role] } : {}),
        onSelect: () => switchWorkspace(w),
      })
    }
    if (caps?.canCreateWorkspace)
      items.push({
        label: 'New workspace',
        icon: <PlusIcon />,
        onSelect: () => setNewWorkspaceOpen(true),
      })
    items.push({ type: 'separator' })
  }
  if (ws) {
    items.push({
      label: 'Insights',
      icon: <InsightsIcon />,
      onSelect: () => go(`/workspaces/${ws}/insights`),
    })
    for (const view of pinnedViews(model?.views))
      items.push({
        label: view.name,
        icon: <ListFilterIcon />,
        onSelect: () => go(`/workspaces/${ws}/views/${encodeURIComponent(view.id)}`),
      })
    items.push({ type: 'separator' })
  }
  // One way into settings, as on the desktop's menu: the workspace's, else the account's.
  items.push({
    label: 'Settings',
    icon: <SettingsIcon />,
    onSelect: () =>
      go(
        workspace
          ? workspaceSettingsPath(workspace.slug, model?.canManage, caps?.instanceAdmin)
          : '/account/profile',
      ),
  })
  items.push({ label: 'Sign out', icon: <LogOutIcon />, onSelect: () => void signOut() })
  return items
}

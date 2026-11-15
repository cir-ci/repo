import {
  Avatar,
  ClosableTabs,
  FrameIcon,
  IconButton,
  InboxIcon,
  type Menu,
  PlusIcon,
  ReviewsIcon,
  SettingsIcon,
  InsightsIcon,
} from '@circi/ui'
import type { ReactNode } from 'react'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { copyLinkItem, menuEntries, separator } from '#lib/row-menu.ts'
import { useTabStore } from '#lib/stores/tab-store.ts'
import { hrefOf, type Tab, titleOf } from '#lib/tabs.ts'

import { projectOfAddress } from './shell-model.ts'

import styles from './TabStrip.module.css'

/** The icon of a page that isn't a project's: what stands in for the project tile. */
function pageIcon(href: string): ReactNode {
  const first = href.split(/[/?#]/).find(Boolean) ?? ''
  if (first === 'inbox') return <InboxIcon size={16} />
  if (first === 'account' || first === 'instance') return <SettingsIcon size={16} />
  if (first === 'workspaces') {
    const page = href.split(/[?#]/)[0]?.split('/')[3]
    if (page === 'reviews') return <ReviewsIcon size={16} />
    if (page === 'insights') return <InsightsIcon size={16} />
    return <SettingsIcon size={16} />
  }
  return <FrameIcon size={16} />
}

/** A tab's tile: its project's (from the sidebar's model, a plain one until that has loaded), else its page's icon. */
export function TabTile({ href }: { href: string }) {
  const project = projectOfAddress(href)
  const { data } = useSidebarModel(project?.workspace)
  if (!project) return <span className={styles.icon}>{pageIcon(href)}</span>
  const known = data?.projects.find((t) => t.slug === project.project)
  return (
    <Avatar
      type="project"
      slug={project.project}
      name={known?.name ?? project.project}
      color={known?.color ?? 'slate'}
      icon={known?.icon ?? null}
      size={16}
      aria-hidden
    />
  )
}

/** The tab menu's items: the same set the phone's long-press sheet offers. */
export function tabMenuItems(tab: Tab, closedCount: number): Menu.Entry[] {
  const { togglePin, duplicate, close, closeOthers, restore } = useTabStore.getState()
  return menuEntries([
    {
      label: tab.pinned ? 'Unpin tab' : 'Pin tab',
      shortcut: '⌥P',
      onSelect: () => togglePin(tab.id),
    },
    { label: 'Duplicate tab', onSelect: () => duplicate(tab.id) },
    copyLinkItem(hrefOf(tab)),
    separator,
    { label: 'Close tab', shortcut: '⌥W', onSelect: () => close(tab.id) },
    { label: 'Close other tabs', onSelect: () => closeOthers(tab.id) },
    closedCount > 0 && { label: 'Reopen closed tab', shortcut: '⌘⇧T', onSelect: restore },
  ])
}

/**
 * The installed app's tabs, as a row: the project tile and the page's title (pinned tabs show the tile
 * or icon only), a close button on hover or focus, a new-tab button at the end. Click switches, the
 * arrow keys move between tabs (Delete closes the focused one), a middle click closes, the right
 * click (or the menu key) opens the tab's menu. The row sits in the window's title bar strip
 * (window-controls-overlay) or at the top of the frame (standalone).
 */
export function TabStrip() {
  const tabs = useTabStore((s) => s.tabs)
  const activeId = useTabStore((s) => s.activeId)
  const closedCount = useTabStore((s) => s.closed.length)
  const activate = useTabStore((s) => s.activate)
  const close = useTabStore((s) => s.close)
  const openNew = useTabStore((s) => s.openNew)

  return (
    <div className={styles.root}>
      <ClosableTabs
        label="Tabs"
        value={activeId}
        onChange={activate}
        onClose={close}
        tabs={tabs.map((tab) => ({
          id: tab.id,
          label: titleOf(tab),
          icon: <TabTile href={hrefOf(tab)} />,
          pinned: tab.pinned,
          menu: tabMenuItems(tab, closedCount),
        }))}
      >
        <IconButton label="New tab" className={styles.new} onClick={openNew}>
          <PlusIcon size={16} />
        </IconButton>
      </ClosableTabs>
    </div>
  )
}

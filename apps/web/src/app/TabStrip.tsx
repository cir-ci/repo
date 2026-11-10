import {
  Avatar,
  CloseIcon,
  ContextMenu,
  FrameIcon,
  IconButton,
  InboxIcon,
  type Menu,
  PlusIcon,
  ReviewIcon,
  SettingsIcon,
  InsightsIcon,
} from '@circi/ui'
import type { MouseEvent, ReactNode } from 'react'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { copyLinkItem, menuEntries, separator } from '#lib/row-menu.ts'
import { useTabStore } from '#lib/stores/tab-store.ts'
import { hrefOf, type Tab, titleOf } from '#lib/tabs.ts'

import { teamOfAddress } from './shell-model.ts'

import styles from './TabStrip.module.css'

/** The icon of a page that isn't a team's: what stands in for the team tile. */
function pageIcon(href: string): ReactNode {
  const first = href.split(/[/?#]/).find(Boolean) ?? ''
  if (first === 'inbox') return <InboxIcon size={16} />
  if (first === 'account' || first === 'instance') return <SettingsIcon size={16} />
  if (first === 'workspaces') {
    const page = href.split(/[?#]/)[0]?.split('/')[3]
    if (page === 'reviews') return <ReviewIcon size={16} />
    if (page === 'insights') return <InsightsIcon size={16} />
    return <SettingsIcon size={16} />
  }
  return <FrameIcon size={16} />
}

/** A tab's tile: its team's (from the sidebar's model, a plain one until that has loaded), else its page's icon. */
export function TabTile({ href }: { href: string }) {
  const team = teamOfAddress(href)
  const { data } = useSidebarModel(team?.workspace)
  if (!team) return <span className={styles.icon}>{pageIcon(href)}</span>
  const known = data?.teams.find((t) => t.slug === team.team)
  return (
    <Avatar
      type="team"
      slug={team.team}
      name={known?.name ?? team.team}
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
 * The installed app's tabs, as a row: the team tile and the page's title (pinned tabs show the tile
 * or icon only), a close button on hover or focus, a new-tab button at the end. Click switches, a
 * middle click closes, the right click (or the menu key) opens the tab's menu. The row sits in the
 * window's title bar strip (window-controls-overlay) or at the top of the frame (standalone).
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
      <div role="tablist" aria-label="Tabs" className={styles.list}>
        {tabs.map((tab) => {
          const label = titleOf(tab)
          const active = tab.id === activeId
          const middleClick = (event: MouseEvent) => {
            if (event.button !== 1) return
            event.preventDefault()
            close(tab.id)
          }
          return (
            <ContextMenu
              key={tab.id}
              items={tabMenuItems(tab, closedCount)}
              trigger={
                <div
                  className={styles.tab}
                  data-active={active ? '' : undefined}
                  data-pinned={tab.pinned ? '' : undefined}
                  role="presentation"
                  onAuxClick={middleClick}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    {...(tab.pinned ? { 'aria-label': label, title: label } : {})}
                    className={styles.main}
                    onClick={() => activate(tab.id)}
                  >
                    <TabTile href={hrefOf(tab)} />
                    {tab.pinned ? null : <span className={styles.label}>{label}</span>}
                  </button>
                  {tab.pinned ? null : (
                    <button
                      type="button"
                      className={styles.close}
                      aria-label={`Close ${label}`}
                      tabIndex={-1}
                      onClick={() => close(tab.id)}
                    >
                      <CloseIcon size={14} />
                    </button>
                  )}
                </div>
              }
            />
          )
        })}
      </div>
      <IconButton label="New tab" className={styles.new} onClick={openNew}>
        <PlusIcon size={16} />
      </IconButton>
    </div>
  )
}

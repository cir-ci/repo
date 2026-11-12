import {
  Avatar,
  CloseIcon,
  ContextMenu,
  FrameIcon,
  IconButton,
  InboxIcon,
  type Menu,
  PlusIcon,
  ReviewsIcon,
  SettingsIcon,
  InsightsIcon,
} from '@circi/ui'
import { type MouseEvent, type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react'

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
 * Puts the highlight under the tab `tabId` (hidden with none). `animate` false jumps there without
 * the glide (the first placement, a resize).
 */
function placeIndicator(
  strip: HTMLElement | null,
  mark: HTMLElement | null,
  tabId: string | null,
  animate: boolean,
): void {
  if (!strip || !mark) return
  const tab = tabId
    ? strip.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(tabId)}"]`)
    : null
  if (!tab) {
    mark.style.opacity = '0'
    return
  }
  if (!animate) mark.dataset['still'] = ''
  mark.style.opacity = '1'
  mark.style.left = `${tab.offsetLeft}px`
  mark.style.width = `${tab.offsetWidth}px`
  if (!animate) {
    // Applied without the transition, then the transition is back for the next move.
    void mark.offsetWidth
    delete mark.dataset['still']
  }
}

/**
 * The active tab's highlight, one element behind the tabs that glides to the active tab (its left
 * and width; the CSS transition does the motion). It is placed without motion the first time, and
 * follows the tab at once when the strip resizes (the window, tabs shrinking as more open).
 */
function useActiveIndicator(
  list: RefObject<HTMLDivElement | null>,
  activeId: string,
  count: number,
) {
  const indicator = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)
  const target = useRef<string | null>(null)
  const skipReport = useRef(true)
  // A switch glides (the first placement doesn't: nothing to glide from).
  useLayoutEffect(() => {
    target.current = count > 0 ? activeId : null
    placeIndicator(list.current, indicator.current, target.current, placed.current)
    placed.current = true
  }, [list, activeId, count])
  // One observer for the strip's life: a new observer reports at once, and acting on that report
  // would cancel a glide in progress, so the first report is skipped.
  useLayoutEffect(() => {
    const strip = list.current
    if (!strip) return undefined
    skipReport.current = true
    const resized = new ResizeObserver(() => {
      if (skipReport.current) skipReport.current = false
      else placeIndicator(strip, indicator.current, target.current, false)
    })
    resized.observe(strip)
    return () => resized.disconnect()
  }, [list])
  return indicator
}

/**
 * The installed app's tabs, as a row: the project tile and the page's title (pinned tabs show the tile
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
  const list = useRef<HTMLDivElement>(null)
  const indicator = useActiveIndicator(list, activeId, tabs.length)

  return (
    <div className={styles.root}>
      <div ref={list} role="tablist" aria-label="Tabs" className={styles.list}>
        <span ref={indicator} className={styles.indicator} aria-hidden="true" />
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
                  data-tab-id={tab.id}
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

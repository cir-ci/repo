import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ColorSchemeControl,
  ContextMenu,
  CopyIcon,
  KeyboardIcon,
  type Menu,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
} from '@circi/ui'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { isInstalled } from '#lib/document-title.ts'
import { copyText, menuEntries, openInNewTab, separator } from '#lib/row-menu.ts'
import { isEditable } from '#lib/shortcuts.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useTabStore } from '#lib/stores/tab-store.ts'
import { activeTab } from '#lib/tabs.ts'
import { isPhone } from '#lib/use-phone.ts'

import { isAppLink } from './tab-sync.ts'

import styles from './AppContextMenu.module.css'

/** Things whose own right-click menu the browser does better (Copy image, Save video as). */
const NATIVE_MEDIA = 'img, canvas, video, audio'
/** Our own overlays: the menu inside them is theirs. */
const OVERLAYS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/**
 * The generic right-click menu: wherever nothing has a menu of its own, the page's own actions
 * (Back, Forward, Reload, Copy link, Search, Keyboard shortcuts, the theme), so a right click
 * never opens the browser's menu with "View page source" in an app. Mounted once in the signed-in
 * frame.
 *
 * It takes the right click only when nobody else has: the rows' menus (`ContextMenu`) call
 * `preventDefault`, and this listens on the document, after them, so the innermost menu wins.
 * The browser's menu stays for text fields (paste, spellcheck), for images, video and canvases
 * (Copy image) and inside dialogs and menus, and on a phone it never opens (a long press over
 * empty space is scrolling). With text selected the menu has Copy at the top instead.
 */
export function AppContextMenu() {
  const router = useRouter()
  const [items, setItems] = useState<Menu.Entry[]>([])
  const anchor = useRef<HTMLDivElement>(null)
  const sending = useRef(false)

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (sending.current || event.defaultPrevented || isPhone()) return
      const target = event.target
      if (!(target instanceof Element) || !anchor.current) return
      if (isEditable(target) || target.closest(NATIVE_MEDIA) || target.closest(OVERLAYS)) return
      const link = target.closest('a[href]')
      const linkHref = link instanceof HTMLAnchorElement && isAppLink(link) ? link.href : undefined
      const selection = window.getSelection()?.toString().trim() ?? ''
      event.preventDefault()
      flushSync(() => setItems(genericItems(router.history, selection, linkHref)))
      // The menu opens where the click was: the trigger takes a contextmenu event of its own.
      sending.current = true
      anchor.current.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      )
      sending.current = false
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => document.removeEventListener('contextmenu', onContextMenu)
  }, [router])

  return (
    <ContextMenu
      items={items.length > 0 ? items : [{ label: 'Menu' }]}
      trigger={<div ref={anchor} className={styles.anchor} aria-hidden="true" />}
    />
  )
}

/** What the menu offers for a right click: `selection` is the selected text, `linkHref` the in-app link under the pointer. */
function genericItems(
  history: ReturnType<typeof useRouter>['history'],
  selection: string,
  linkHref: string | undefined,
): Menu.Entry[] {
  const tabs = useTabStore.getState()
  const overlay = useOverlayStore.getState()
  const tab = tabs.tabs.length > 0 ? activeTab(tabs) : undefined
  // The tab's own history once the app has tabs; the router's otherwise.
  const canBack =
    isInstalled() && tab ? tab.index > 0 || tab.opener !== undefined : history.canGoBack()
  const canForward = isInstalled() && tab ? tab.index < tab.history.length - 1 : true
  return menuEntries([
    selection !== '' && {
      label: 'Copy',
      icon: <CopyIcon />,
      onSelect: () => void copyText(selection, 'Text'),
    },
    selection !== '' && separator,
    {
      label: 'Back',
      icon: <ChevronLeftIcon />,
      disabled: !canBack,
      onSelect: () => history.back(),
    },
    {
      label: 'Forward',
      icon: <ChevronRightIcon />,
      disabled: !canForward,
      onSelect: () => history.forward(),
    },
    { label: 'Reload', icon: <RefreshIcon />, onSelect: () => window.location.reload() },
    separator,
    linkHref !== undefined && {
      label: 'Open in new tab',
      icon: <PlusIcon />,
      onSelect: () => openInNewTab(linkHref),
    },
    {
      label: 'Copy link',
      icon: <CopyIcon />,
      onSelect: () => void copyText(linkHref ?? window.location.href, 'Link'),
    },
    separator,
    {
      label: 'Search…',
      icon: <SearchIcon />,
      shortcut: '⌘K',
      onSelect: () => overlay.setCommandMenuOpen(true),
    },
    {
      label: 'Keyboard shortcuts',
      icon: <KeyboardIcon />,
      shortcut: '?',
      onSelect: () => overlay.setHelpOpen(true),
    },
    separator,
    {
      type: 'content',
      name: 'Theme',
      node: (
        <div className={styles.theme}>
          <ColorSchemeControl fill />
        </div>
      ),
    },
  ])
}

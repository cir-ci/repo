import { useRouter, useRouterState } from '@tanstack/react-router'
import { type ReactNode, useEffect } from 'react'

import { useInstalled, useWindowTitle } from '#lib/document-title.ts'
import { useTabStore } from '#lib/stores/tab-store.ts'
import { activeTab, hrefOf } from '#lib/tabs.ts'

import { hrefFrom, installTabSync, isAppLink } from './tab-sync.ts'

/** The link under a click, when it goes to a page of the app. */
function appLinkAt(event: MouseEvent): HTMLAnchorElement | undefined {
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null
  return link instanceof HTMLAnchorElement && isAppLink(link) ? link : undefined
}

/**
 * In the installed app: takes this person's tabs, keeps the router and the tabs in step
 * (`installTabSync`), records the page's title on its tab, and opens in-app links in a new tab on
 * ⌘/Ctrl-click and middle-click. The page (`children`) renders once the tabs are in place, so no
 * page runs (and redirects) before the saved tab decides where the window is. In a browser tab it
 * is just its children.
 */
export function TabGate({ userId, children }: TabGate.Props) {
  const router = useRouter()
  const installed = useInstalled()
  // The tabs are this person's once `adopt` has said so (the effect below); until then no page renders.
  const ready = useTabStore((s) => !installed || s.owner === userId)

  useEffect(() => {
    if (!installed) return undefined
    useTabStore.getState().adopt(userId, hrefFrom(router.history.location.href))
    const uninstall = installTabSync(router.history)
    return uninstall
  }, [installed, userId, router])

  // A new tab or a middle click in a link opens a background tab, as in a browser.
  useEffect(() => {
    if (!installed) return undefined
    const open = (event: MouseEvent) => {
      const link = appLinkAt(event)
      if (!link) return
      event.preventDefault()
      event.stopPropagation()
      useTabStore.getState().open(hrefFrom(link.href), { background: true })
    }
    const onClick = (event: MouseEvent) => {
      if (event.button === 0 && (event.metaKey || event.ctrlKey) && !event.shiftKey) open(event)
    }
    const onAuxClick = (event: MouseEvent) => {
      if (event.button === 1) open(event)
    }
    document.addEventListener('click', onClick, true)
    document.addEventListener('auxclick', onAuxClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('auxclick', onAuxClick, true)
    }
  }, [installed])

  // The page's title names its tab, once the page showing is the tab's.
  const title = useWindowTitle()
  const location = useRouterState({ select: (s) => s.location.href })
  const activeId = useTabStore((s) => s.activeId)
  const shown = useTabStore((s) => (s.tabs.length > 0 ? hrefOf(activeTab(s)) : undefined))
  useEffect(() => {
    if (!installed || !ready || !title || hrefFrom(location) !== shown) return
    useTabStore.getState().setTitle(activeId, title)
  }, [installed, ready, title, location, shown, activeId])

  return ready ? children : null
}

export namespace TabGate {
  export interface Props {
    userId: string
    children: ReactNode
  }
}

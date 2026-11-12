import { useEffect, useRef } from 'react'

import { useInstalled, useOverlay } from '#lib/document-title.ts'
import { useTabStore } from '#lib/stores/tab-store.ts'
import { usePhone } from '#lib/use-phone.ts'

import { TabStrip } from './TabStrip.tsx'

import styles from './TabRow.module.css'

/** The row's height: what everything that sticks to the top sticks below. */
const ROW_HEIGHT = '36px'

/**
 * The tabs as the first row of the page's panel, in an installed window that has no title bar
 * strip of its own (standalone or full screen, where `WindowTitleBar` isn't shown): over the page
 * only, so the sidebar still reaches the top of the window, and above the page's header and its
 * scroller (the frame's `panelTop`), so the tabs stay put when the page scrolls. The row sets
 * `--circi-window-top` on the panel, not the window, so the sidebar doesn't move. Nothing in a
 * browser tab, on a phone (its switcher is a sheet) or in overlay mode (the title bar has them).
 * Full screen has no title bar strip, so there the tabs are in this row.
 */
export function TabRow() {
  const phone = usePhone()
  const hasTabs = useTabStore((s) => s.tabs.length > 0)
  // Followed live: in full screen the title bar strip is gone, so the tabs move here.
  const installed = useInstalled()
  const overlay = useOverlay()
  const shown = hasTabs && !phone && installed && !overlay
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const panel = row.current?.closest<HTMLElement>('[data-panel]')
    if (!shown || !panel) return undefined
    panel.style.setProperty('--circi-window-top', ROW_HEIGHT)
    return () => {
      panel.style.removeProperty('--circi-window-top')
    }
  }, [shown])
  if (!shown) return null
  return (
    <div ref={row} className={styles.root} data-tab-row="">
      <TabStrip />
    </div>
  )
}

import { useEffect } from 'react'

import { useInstalled, useOverlay } from '#lib/document-title.ts'
import { useTabStore } from '#lib/stores/tab-store.ts'
import { usePhone } from '#lib/use-phone.ts'

import { TabStrip } from './TabStrip.tsx'

import styles from './TabRow.module.css'

/** The row's height: what everything that sticks to the top sticks below. */
const ROW_HEIGHT = '36px'

/**
 * The tabs as the first row of an installed window that has no title bar strip of its own
 * (standalone mode, where `WindowTitleBar` isn't shown): above the sidebar and the page header, so
 * they stay as they are, and sticky so the tabs stay put when the page scrolls. Nothing in a
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
  useEffect(() => {
    if (!shown) return undefined
    const root = document.documentElement
    root.style.setProperty('--circi-window-top', ROW_HEIGHT)
    return () => {
      root.style.removeProperty('--circi-window-top')
    }
  }, [shown])
  if (!shown) return null
  return (
    <div className={styles.root}>
      <TabStrip />
    </div>
  )
}

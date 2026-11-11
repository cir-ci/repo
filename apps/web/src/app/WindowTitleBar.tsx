import { Logo } from '#features/auth/Logo.tsx'
import { useOverlay, useWindowTitle } from '#lib/document-title.ts'
import { useTabStore } from '#lib/stores/tab-store.ts'
import { usePhone } from '#lib/use-phone.ts'

import { TabStrip } from './TabStrip.tsx'

import styles from './WindowTitleBar.module.css'

/**
 * The installed app's own title bar. In the manifest's window-controls-overlay mode the browser
 * hides its title bar (and its extension and app icons) and leaves only the window's controls;
 * this bar fills the rest of that strip (beside the controls, in the `titlebar-area-*` space) with
 * the logo and the tabs, and the window drags by the gaps. With no tabs (a phone, or before they
 * are loaded) it shows the page's title instead. Outside that mode it isn't shown.
 */
export function WindowTitleBar() {
  const title = useWindowTitle()
  const phone = usePhone()
  const hasTabs = useTabStore((s) => s.tabs.length > 0)
  const overlay = useOverlay()
  const tabs = hasTabs && !phone && overlay
  return (
    <div className={styles.root} aria-hidden={tabs ? undefined : 'true'}>
      <Logo size={16} />
      {tabs ? (
        <div className={styles.tabs}>
          <TabStrip />
        </div>
      ) : (
        <span className={styles.title}>{title}</span>
      )}
    </div>
  )
}

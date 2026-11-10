import { Sheet } from '@circi/ui'
import { useEffect, type MouseEvent } from 'react'

import { SettingsNav } from '#features/sidebar/SettingsNav.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'

import styles from './SettingsSections.module.css'

/**
 * Settings' own navigation on a phone: the settings pages in a sheet opened from the page header's
 * Sections button. Choosing a page closes it (even the one already shown). The way out of settings
 * is the header's Close, as everywhere in this closed area.
 */
export function SettingsSections() {
  const open = useOverlayStore((s) => s.settingsNavOpen)
  const setOpen = useOverlayStore((s) => s.setSettingsNavOpen)

  // Leaving the phone layout (or settings) must not leave it open for next time.
  useEffect(() => () => setOpen(false), [setOpen])

  const close = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('a')) setOpen(false)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen} title="Settings sections" size="tall">
      <div role="presentation" className={styles.list} onClick={close}>
        <SettingsNav />
      </div>
    </Sheet>
  )
}

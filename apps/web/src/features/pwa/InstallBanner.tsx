import { Banner, Button } from '@circi/ui'

import { shouldOfferInstall } from '#lib/prompt-rules.ts'
import { useNow } from '#lib/RelativeTime.tsx'
import { usePwaStore } from '#lib/stores/pwa-store.ts'

import { useInstall } from './use-install.ts'

import styles from './Pwa.module.css'

/**
 * The offer to install the dashboard as an app, inside the Inbox's panel under its header: after
 * the second visit or the first approval, never on the first load. "Not now" hides it for 14
 * days, at most three times (`prompt-rules.ts`). The account menu's Install app item is always
 * there for the person who looks for it.
 */
export function InstallBanner() {
  const { canInstall, install, mobile } = useInstall()
  const visits = usePwaStore((s) => s.visits)
  const approved = usePwaStore((s) => s.approved)
  const installed = usePwaStore((s) => s.installed)
  const dismissals = usePwaStore((s) => s.install)
  const putOff = usePwaStore((s) => s.putOffInstall)
  const now = useNow()

  if (!shouldOfferInstall({ visits, approved, installed, canInstall, dismissals, now })) {
    return null
  }
  return (
    <div className={styles.wrap}>
      <Banner
        title={mobile ? 'Add CirCI to your home screen.' : 'Install CirCI'}
        action={
          <div className={styles.actions}>
            <Button size="sm" variant="primary" onClick={() => void install()}>
              Install
            </Button>
            <Button size="sm" variant="ghost" onClick={() => putOff(Date.now())}>
              Not now
            </Button>
          </div>
        }
      >
        {mobile ? 'Opens full screen, with notifications.' : 'to open it in its own window.'}
      </Banner>
    </div>
  )
}

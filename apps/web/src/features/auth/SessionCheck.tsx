import { Delayed } from '@circi/ui'

import { Logo } from './Logo.tsx'

import page from './AuthPage.module.css'
import styles from './SessionCheck.module.css'

/**
 * What a refresh shows while the session is checked: the sign-in page's ground and logo, so the
 * app never flashes another look. The check takes well under a second, so only the logo shows at
 * first; a note follows below it if it drags on. The logo is centred on its own, as in the loading
 * screen index.html draws before any script (src/boot.css), so it stays put when this takes over.
 */
export function SessionCheck() {
  return (
    <div className={page.page}>
      <main id="content" tabIndex={-1} className={page.column} aria-busy="true">
        <div className={styles.mark}>
          <Logo size={56} alt="CirCI" className={page.logo} />
          <div className={styles.note}>
            <Delayed>
              <p role="status" className={page.subtitle}>
                Checking your session…
              </p>
            </Delayed>
          </div>
        </div>
      </main>
    </div>
  )
}

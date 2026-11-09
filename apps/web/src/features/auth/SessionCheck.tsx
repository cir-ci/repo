import { Delayed } from '@circi/ui'

import logo from './logo.svg'

import styles from './AuthPage.module.css'

/**
 * What a refresh shows while the session is checked: the sign-in page's ground and logo, so the
 * app never flashes another look. The check takes well under a second, so only the logo shows at
 * first; a note follows if it drags on.
 */
export function SessionCheck() {
  return (
    <div className={styles.page}>
      <main id="content" tabIndex={-1} className={styles.column} aria-busy="true">
        <div className={styles.head}>
          <img src={logo} alt="CirCI" width={56} height={56} className={styles.logo} />
          <Delayed>
            <p role="status" className={styles.subtitle}>
              Checking your session…
            </p>
          </Delayed>
        </div>
      </main>
    </div>
  )
}

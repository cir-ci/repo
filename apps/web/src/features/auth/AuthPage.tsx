import type { ReactNode } from 'react'

import { Logo } from './Logo.tsx'

import styles from './AuthPage.module.css'

/**
 * The sign-in and setup pages, outside the sidebar frame: no card, no top bar. One centred
 * 360px column on the page's glow: the logo, the title, a line under it, then the page's own
 * content. "Self-hosted CirCI" sits at the foot. The `main` carries `id="content"`, which the
 * shell's skip link points at.
 */
export function AuthPage({ title, subtitle, wide, children }: AuthPage.Props) {
  return (
    <div className={styles.page}>
      <main
        id="content"
        tabIndex={-1}
        className={wide ? `${styles.column} ${styles.wide}` : styles.column}
      >
        <header className={styles.head}>
          <Logo size={56} className={styles.logo} />
          <div>
            <h1 className={styles.title}>{title}</h1>
            {/* Text in a paragraph; anything else (the setup's progress bar) in a div, which a p can't hold. */}
            {typeof subtitle === 'string' ? (
              <p className={styles.subtitle}>{subtitle}</p>
            ) : subtitle ? (
              <div className={styles.subtitle}>{subtitle}</div>
            ) : null}
          </div>
        </header>
        {children}
      </main>
      <p className={styles.foot}>Self-hosted CirCI</p>
    </div>
  )
}

export namespace AuthPage {
  export interface Props {
    title: ReactNode
    /** The line under the title: the instance's address, or what the page is for. */
    subtitle?: ReactNode
    /** A wider column, for a page that shows code to copy. */
    wide?: boolean
    children: ReactNode
  }
}

import type { ReactNode, Ref } from 'react'

import { Logo } from './Logo.tsx'

import styles from './AuthPage.module.css'

/**
 * The sign-in and setup pages, outside the sidebar frame: no card, no top bar. One centred
 * 360px column on the page's glow: the logo, the title, a line under it, then the page's own
 * content. "Self-hosted CirCI" sits at the foot. The `main` carries `id="content"`, which the
 * shell's skip link points at.
 */
export function AuthPage({ title, titleRef, subtitle, wide, compact, children }: AuthPage.Props) {
  return (
    <div className={styles.page}>
      <main
        id="content"
        tabIndex={-1}
        className={[styles.column, wide && styles.wide, compact && styles.compact]
          .filter(Boolean)
          .join(' ')}
      >
        <header className={styles.head}>
          <Logo size={compact ? 48 : 56} className={styles.logo} />
          <div>
            <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined} className={styles.title}>
              {title}
            </h1>
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
      <footer className={styles.foot}>Self-hosted CirCI</footer>
    </div>
  )
}

export namespace AuthPage {
  export interface Props {
    title: ReactNode
    /** Makes the title focusable from code (not by Tab), for a step that has no field to move focus to. */
    titleRef?: Ref<HTMLHeadingElement>
    /** The line under the title: the instance's address, or what the page is for. */
    subtitle?: ReactNode
    /** A wider column, for a page that shows code to copy. */
    wide?: boolean
    /** The setup steps' tighter head (48px logo, progress 12px under the title) and 24px gaps, as on the setup board. */
    compact?: boolean
    children: ReactNode
  }
}

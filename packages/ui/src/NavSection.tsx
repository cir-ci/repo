import { type ReactNode, useId } from 'react'

import styles from './NavSection.module.css'

/** A labelled group of `NavItem`s in a navigation (a landmark-free `section` named by its label). */
export function NavSection({ label, actions, children }: NavSection.Props) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={styles.root}>
      <div className={styles.head}>
        <div id={id} className={styles.label}>
          {label}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export namespace NavSection {
  export interface Props {
    /** Names the section; a node so it can hold an avatar or a project mark. */
    label: ReactNode
    /** Controls beside the label (a switcher): outside the section's name. */
    actions?: ReactNode
    children: ReactNode
  }
}

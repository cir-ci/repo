import { type ReactNode, useId } from 'react'

import { cx } from './cx.ts'

import styles from './Pane.module.css'

/**
 * The preview pane beside a list: a `region` landmark named by `label`, a context header (what
 * the pane is showing), the content, and the actions at the bottom right. `width` is a tier:
 * `sm` 280px, `md` 340px, `lg` 420px (all shrink on a narrow screen).
 */
export function Pane({ label, context, actions, width = 'md', className, children }: Pane.Props) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cx(styles['root'], className)} data-width={width}>
      <header className={styles['header']}>
        <h2 id={id} className={styles['label']}>
          {label}
        </h2>
        {context ? <span className={styles['context']}>{context}</span> : null}
      </header>
      <div className={styles['body']}>{children}</div>
      {actions ? <footer className={styles['actions']}>{actions}</footer> : null}
    </section>
  )
}

export namespace Pane {
  export interface Props {
    /** The pane's accessible name (its heading), e.g. "Preview". */
    label: ReactNode
    /** What the pane is about, shown in the header beside the label (a build, a snapshot name). */
    context?: ReactNode
    /** Buttons at the bottom right. */
    actions?: ReactNode
    width?: 'sm' | 'md' | 'lg'
    className?: string
    children?: ReactNode
  }
}

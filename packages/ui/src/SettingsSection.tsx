import { type ComponentPropsWithRef, type ReactNode, useId } from 'react'

import { cx } from './cx.ts'

import styles from './SettingsSection.module.css'

/**
 * A group on a settings page: a heading (`h2`), an optional description and actions, then a
 * bordered box of `SettingsRow`s. `tone="danger"` is the danger zone: a rejected-coloured border.
 * The section is a labelled region named by its heading. Children that are not rows (a form, a
 * note) go in the box too; use `bare` to render them without the box.
 */
export function SettingsSection({
  title,
  description,
  actions,
  tone = 'default',
  headingLevel = 2,
  bare = false,
  className,
  children,
  ...rest
}: SettingsSection.Props) {
  const titleId = useId()
  const Heading = `h${headingLevel}` as const
  return (
    <section
      {...rest}
      className={cx(styles.root, className)}
      data-tone={tone}
      aria-labelledby={titleId}
    >
      <header className={styles.header}>
        <div className={styles.text}>
          <Heading id={titleId} className={styles.title}>
            {title}
          </Heading>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      {bare ? children : <div className={styles.box}>{children}</div>}
    </section>
  )
}

export namespace SettingsSection {
  export interface Props extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
    title: ReactNode
    description?: ReactNode
    actions?: ReactNode
    /** `danger` for a danger zone. */
    tone?: 'default' | 'danger'
    headingLevel?: 2 | 3
    /** No bordered box around the children. */
    bare?: boolean
  }
}

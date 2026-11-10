import { type ComponentPropsWithRef, type ReactNode, useId } from 'react'

import { cx } from './cx.ts'

import styles from './SettingsPage.module.css'

/**
 * The centred column every settings and health page sits in: 720px (`width="wide"`: 1040px, for
 * editors that need the room), 40px between its children, a 16px gutter at phone width. The page sits in a `settings` container (the space the panel gives
 * it, not the window): from 900px of it the column widens to 960px and rows and fields put the
 * label and its help in a 240px column on the left, the control on the right; below that they stack. The
 * optional header is a title (an `h1` unless `headingLevel` says otherwise), a description and
 * actions; put `SettingsSection`s inside.
 */
export function SettingsPage({
  title,
  description,
  actions,
  headingLevel = 1,
  width = 'default',
  className,
  children,
  ...rest
}: SettingsPage.Props) {
  const titleId = useId()
  const Heading = `h${headingLevel}` as const
  return (
    <div className={styles.frame}>
      <div
        {...rest}
        className={cx(styles.root, className)}
        data-width={width}
        aria-labelledby={title ? titleId : undefined}
      >
        {title || description || actions ? (
          <header className={styles.header}>
            <div className={styles.text}>
              {title ? (
                <Heading id={titleId} className={styles.title}>
                  {title}
                </Heading>
              ) : null}
              {description ? <p className={styles.description}>{description}</p> : null}
            </div>
            {actions ? <div className={styles.actions}>{actions}</div> : null}
          </header>
        ) : null}
        {children}
      </div>
    </div>
  )
}

export namespace SettingsPage {
  export interface Props extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
    title?: ReactNode
    description?: ReactNode
    /** Buttons on the right of the header; they wrap under the title when narrow. */
    actions?: ReactNode
    headingLevel?: 1 | 2
    /** `default` is 720px; `wide` is 1040px. */
    width?: 'default' | 'wide'
  }
}

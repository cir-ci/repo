import { Kbd } from '@circi/ui'
import { useId } from 'react'

import { isSingleKey, keyCaps, shortcutGroups } from '#lib/shortcuts.ts'

import styles from './ShortcutGroups.module.css'

/**
 * Every keyboard shortcut from the registry: one card per group in a grid that wraps from several
 * columns down to one. Shared by the Keyboard shortcuts page and the `?` dialog, so both read the
 * same way.
 */
export function ShortcutGroups({
  designEnabled = false,
  headingLevel = 2,
  focusable = false,
  markSingleKey = false,
}: ShortcutGroups.Props) {
  // Unique per instance: the dialog can be open over the page.
  const prefix = useId()
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  return (
    <div
      className={styles.grid}
      {...(focusable ? { tabIndex: 0, role: 'group', 'aria-label': 'Keyboard shortcuts' } : {})}
    >
      {shortcutGroups(designEnabled).map(({ group, shortcuts }) => {
        const id = `${prefix}-${group.toLowerCase().replaceAll(' ', '-')}`
        return (
          <section key={group} className={styles.card} aria-labelledby={id}>
            <Heading id={id} className={styles.title}>
              {group}
            </Heading>
            <dl className={styles.rows}>
              {shortcuts.map((s) => (
                <div key={s.key} className={styles.row}>
                  <dt className={styles.action}>
                    <span>{s.description}</span>
                    {markSingleKey && isSingleKey(s) ? (
                      <span className={styles.single}> (single key)</span>
                    ) : null}
                  </dt>
                  <dd className={styles.keys}>
                    {keyCaps(s.key).map((cap) => (
                      <Kbd key={cap}>{cap}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )
      })}
    </div>
  )
}

export namespace ShortcutGroups {
  export interface Props {
    /** Lists the Design mode key too. */
    designEnabled?: boolean
    /** 2 on the page (under its h1), 3 in the dialog (under its title). */
    headingLevel?: 2 | 3
    /** The page's list is long enough to scroll its panel: it takes a Tab stop so the keys can scroll it. */
    focusable?: boolean
    /** Marks the rows that are one key, which the "Single-key shortcuts" setting turns off. */
    markSingleKey?: boolean
  }
}

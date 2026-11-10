import { Avatar, Button, Kbd } from '@circi/ui'

import { fileUrl } from '#features/builds/api/index.ts'

import type { Entry } from './entry.ts'
import { peekButton, TIPS } from './model.ts'

import styles from './CommandMenu.module.css'

/**
 * The pane beside the list (hidden under 900px): the kind and name of the highlighted row, a line
 * saying what it is or what choosing it does, the facts the row already holds, and the button
 * with the Enter verb. With nothing highlighted a tip says what else the menu can do.
 */
export function CommandPeek({ entry, tip, onChoose }: CommandPeek.Props) {
  return (
    <aside aria-label="Peek" className={styles.peek}>
      {entry ? (
        <>
          {entry.peek.thumb ? (
            <div className={styles.peekThumb}>
              <img src={fileUrl(entry.peek.thumb)} alt="" loading="lazy" />
            </div>
          ) : null}
          <div className={styles.peekHead}>
            <span className={styles.peekSub}>{entry.peek.kind}</span>
            {entry.peek.avatar ? (
              <span className={styles.peekPerson}>
                <Avatar
                  type="user"
                  id={entry.peek.avatar.id}
                  name={entry.peek.avatar.name}
                  image={entry.peek.avatar.image}
                  size={24}
                />
                <span className={styles.peekTitle}>{entry.peek.title}</span>
              </span>
            ) : (
              <span className={styles.peekTitle}>{entry.peek.title}</span>
            )}
          </div>
          {entry.peek.lines.map((line) => (
            <p key={line} className={styles.peekText}>
              {line}
            </p>
          ))}
          <dl className={styles.rows}>
            {entry.peek.rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          <div className={styles.peekFoot}>
            {entry.path ? (
              <span className={styles.peekHint}>
                <Kbd>⌘↵</Kbd> New tab
              </span>
            ) : null}
            <Button size="sm" onClick={onChoose}>
              {peekButton(entry)}
            </Button>
          </div>
        </>
      ) : (
        <div className={styles.peekHead}>
          <span className={styles.peekSub}>Tip</span>
          <span className={styles.peekText}>{TIPS[tip % TIPS.length]}</span>
        </div>
      )}
    </aside>
  )
}

export namespace CommandPeek {
  export interface Props {
    entry: Entry | undefined
    /** Which tip shows when nothing is highlighted. */
    tip: number
    onChoose: () => void
  }
}

import { workspaceLetter, workspaceMark } from '#app/shell-model.ts'

import styles from './WorkspaceTile.module.css'

/**
 * A workspace's mark: its first letter on a rounded square. The workspace being shown is the
 * brand's maroon with white text, the others are neutral. Decorative: the name is written beside it.
 */
export function WorkspaceTile({ name, slug, current, size = 20 }: WorkspaceTile.Props) {
  return (
    <span
      aria-hidden="true"
      data-size={size}
      data-mark={workspaceMark(slug, current)}
      className={styles.root}
    >
      {workspaceLetter(name)}
    </span>
  )
}

export namespace WorkspaceTile {
  export interface Props {
    name: string
    slug: string
    /** The slug of the workspace being shown. */
    current: string | undefined
    size?: 16 | 20 | 24
  }
}

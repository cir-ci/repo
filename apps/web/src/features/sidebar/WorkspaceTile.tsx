import { workspaceLetter, workspaceMark } from '#app/shell-model.ts'

import styles from './WorkspaceTile.module.css'

/**
 * A workspace's mark: its first letter on a rounded square. The workspace being shown is the
 * brand's maroon with white text, the others are neutral. With a picture, the picture fills the square. Decorative: the name is written beside it.
 */
export function WorkspaceTile({ name, slug, current, picture, size = 20 }: WorkspaceTile.Props) {
  return (
    <span
      aria-hidden="true"
      data-size={size}
      data-mark={workspaceMark(slug, current)}
      data-picture={picture ? '' : undefined}
      className={styles.root}
    >
      {picture ? <img src={picture} alt="" className={styles.picture} /> : workspaceLetter(name)}
    </span>
  )
}

export namespace WorkspaceTile {
  export interface Props {
    name: string
    slug: string
    /** The slug of the workspace being shown. */
    current: string | undefined
    /** The workspace's picture, when it has one: it replaces the letter. */
    picture?: string | null | undefined
    size?: 16 | 20 | 24
  }
}

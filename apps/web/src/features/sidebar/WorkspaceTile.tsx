import { workspaceLetter } from '#app/shell-model.ts'

import styles from './WorkspaceTile.module.css'

/**
 * A workspace's mark: its first letter on a rounded square in the brand's maroon with white text,
 * the same for every workspace whether or not it is the open one. With a picture, the picture fills the square. Decorative: the name is written beside it.
 */
export function WorkspaceTile({ name, picture, size = 20 }: WorkspaceTile.Props) {
  return (
    <span
      aria-hidden="true"
      data-size={size}
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
    /** The workspace's picture, when it has one: it replaces the letter. */
    picture?: string | null | undefined
    size?: 16 | 20 | 24
  }
}

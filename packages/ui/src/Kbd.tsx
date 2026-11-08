import type { ReactNode } from 'react'

import styles from './Kbd.module.css'

/** A keyboard key cap, for shortcut hints next to actions and in the command menu. */
export function Kbd(props: Kbd.Props) {
  return <kbd className={styles.root}>{props.children}</kbd>
}

export namespace Kbd {
  export interface Props {
    children: ReactNode
  }
}

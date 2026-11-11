import type { MouseEvent, ReactNode } from 'react'

import styles from './PhoneMore.module.css'

/** A 48px link row of a phone sheet (More, Projects); it goes through `onGo`, which closes the sheet. */
export function SheetRow({ href, icon, trailing, more, children, onGo }: SheetRow.Props) {
  const go = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    onGo(href)
  }
  return (
    <a className={styles.row} href={href} onClick={go} data-more={more ? '' : undefined}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.label}>{children}</span>
      {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
    </a>
  )
}

export namespace SheetRow {
  export interface Props {
    href: string
    icon?: ReactNode
    /** At the right: a pin, a count. */
    trailing?: ReactNode
    /** A pointer to the rest of a list ("All projects"): secondary text, indented under the icons. */
    more?: boolean
    children: ReactNode
    onGo: (href: string) => void
  }
}

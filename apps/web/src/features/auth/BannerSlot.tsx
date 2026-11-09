import { Banner } from '@circi/ui'
import type { ReactNode } from 'react'

import styles from './AuthForms.module.css'

/**
 * The place below a form's submit button for one message. It keeps the height of a banner whether or not
 * there is one, so a failed attempt doesn't move the fields. A `danger` banner is an alert.
 */
export function BannerSlot({ tone = 'danger', children }: BannerSlot.Props) {
  return (
    <div className={styles.slot}>{children ? <Banner tone={tone}>{children}</Banner> : null}</div>
  )
}

export namespace BannerSlot {
  export interface Props {
    tone?: Banner.Props['tone']
    /** The message; nothing keeps the slot empty. */
    children?: ReactNode
  }
}

import { Button as BaseButton } from '@base-ui/react/button'
import type { ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './EnlargeTrigger.module.css'

/**
 * Wraps an image so that a click on it opens the `ImageDialog`; hover or keyboard focus shows an
 * "Enlarge" chip in its corner. It is a real button named by `label` ("Enlarge this build").
 */
export function EnlargeTrigger({ label, children, className, ...rest }: EnlargeTrigger.Props) {
  return (
    <BaseButton type="button" {...rest} aria-label={label} className={cx(styles.root, className)}>
      {children}
      <span className={styles.chip} aria-hidden="true">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
        Enlarge
      </span>
    </BaseButton>
  )
}

export namespace EnlargeTrigger {
  export interface Props extends Omit<
    BaseButton.Props,
    'render' | 'children' | 'className' | 'aria-label' | 'aria-labelledby'
  > {
    /** The accessible name ("Enlarge baseline"). */
    label: string
    /** The image. */
    children: ReactNode
    className?: string
  }
}

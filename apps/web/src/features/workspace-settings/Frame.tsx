import type { ReactNode } from 'react'

import { PageFrame } from '#lib/PageFrame.tsx'

import styles from './Settings.module.css'

/** The header and one column every settings page here shares, with its loading and error states. */
export function Frame({ crumbs, ...rest }: Frame.Props) {
  return (
    <PageFrame
      crumbs={crumbs.slice(0, -1).map((label) => ({ label }))}
      title={crumbs.at(-1) ?? ''}
      contentClassName={styles.content}
      {...rest}
    />
  )
}

export namespace Frame {
  export interface Props {
    /** The path to the page, outermost first; the last is the page's `<h1>`. */
    crumbs: string[]
    loading?: boolean
    error?: Error | null
    onRetry?: () => void
    notFound?: string
    /** Shown above the page when the viewer can look but not change. */
    readOnlyNote?: string | false
    children: ReactNode
  }
}

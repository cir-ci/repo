import { Heading, Text } from '@circi/ui'
import type { ReactNode } from 'react'

import { ProviderLogo } from './logos.tsx'

import styles from './Integrations.module.css'

/**
 * The top of an integration's page: the provider's mark, its name and what it is connected to,
 * the connection's state (a dot and a word, never colour alone) and the page's actions
 * (Reconnect, Remove). The page's `<h1>` is the breadcrumb above, so the name here is not a heading.
 */
export function IntegrationHead(props: IntegrationHead.Props) {
  return (
    <div className={styles.pageHead}>
      <ProviderLogo kind={props.logo} size={40} />
      <div className={styles.pageTitle}>
        <Heading level="title" as="p">
          {props.name}
        </Heading>
        <Text variant="small" tone="secondary">
          {props.line}
        </Text>
      </div>
      <span
        className={`${styles.status} ${props.needsAttention ? styles.statusBad : styles.statusOk}`}
      >
        <span className={styles.dot} aria-hidden="true" />
        {props.needsAttention ? 'Needs attention' : 'Connected'}
      </span>
      {props.actions}
    </div>
  )
}

export namespace IntegrationHead {
  export interface Props {
    logo: string
    name: string
    line: string
    needsAttention: boolean
    actions?: ReactNode
  }
}

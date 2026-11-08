import { Heading, Surface, Text } from '@circi/ui'
import type { ReactNode } from 'react'

import styles from './AuthPanel.module.css'

/**
 * The layout of the screens outside the sidebar frame (docs/design-gaps.md §10, provisional): a
 * centred 400px panel with a display title, one line of explanation and then the form. The
 * logo bar and the ground come from the shell's plain frame.
 */
export function AuthPanel({ title, description, children }: AuthPanel.Props) {
  return (
    <Surface variant="panel" className={styles.panel}>
      <div className={styles.head}>
        <Heading level="display">{title}</Heading>
        {description ? (
          <Text as="p" tone="secondary">
            {description}
          </Text>
        ) : null}
      </div>
      {children}
    </Surface>
  )
}

export namespace AuthPanel {
  export interface Props {
    title: ReactNode
    description?: ReactNode
    children: ReactNode
  }
}

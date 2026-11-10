import { defaultIssueTitle } from '@circi/core'
import { Heading, Text } from '@circi/ui'

import styles from './Integrations.module.css'

/** What "Create issue" sends to a tracker, from a rejected snapshot in a build (the same title the server uses). */
export function TrackerPreview({ name }: { name: string }) {
  return (
    <section className={styles.section} aria-labelledby="sends-title">
      <div>
        <Heading level="title" as="h2" id="sends-title">
          What “Create issue” sends
        </Heading>
        <Text as="p" variant="small" tone="secondary">
          From a screenshot in a build. The person creating it can edit the title first.
        </Text>
      </div>
      <dl className={`${styles.box} ${styles.preview}`} aria-label={`What ${name} receives`}>
        <div className={styles.field}>
          <Text as="dt" variant="small" tone="secondary">
            Title
          </Text>
          <Text as="dd">{defaultIssueTitle('checkout / summary', 148)}</Text>
        </div>
        <div className={styles.field}>
          <Text as="dt" variant="small" tone="secondary">
            Description
          </Text>
          <Text as="dd" variant="small" tone="secondary">
            The build and its branch, who rejected it and why, and a link to the diff.
          </Text>
        </div>
      </dl>
    </section>
  )
}

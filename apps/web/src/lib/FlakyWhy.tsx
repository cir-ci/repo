import type { Flaky } from '@circi/api'
import { flakyEvidence, flakyReasonText } from '@circi/core'
import type { MouseEventHandler } from 'react'

import styles from './FlakyWhy.module.css'

/**
 * Why a screenshot is flaky: the sentence, and the evidence as a list of the builds involved
 * ("#7 went back to #5's image", "#9: 2 of 3 runs differ"). The builds are links when `linkOf`
 * gives one; without it (settings is a closed area) they are plain text.
 */
export function FlakyWhy({ reason, linkOf, name }: FlakyWhy.Props) {
  const evidence = flakyEvidence(reason)
  return (
    <div className={styles.root}>
      <p className={styles.sentence}>{flakyReasonText(reason, { detail: true })}</p>
      {evidence.length > 0 ? (
        <ul aria-label="Evidence" className={styles.evidence}>
          {evidence.map((e) => {
            const link = linkOf?.(e.build)
            return (
              <li key={`${e.build}${e.rest}`}>
                {link ? (
                  <a
                    className={styles.link}
                    href={link.href}
                    onClick={link.onClick}
                    aria-label={`Open ${name ?? 'the screenshot'} in build #${e.build}`}
                  >
                    #{e.build}
                  </a>
                ) : (
                  <span>#{e.build}</span>
                )}
                {e.rest}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

export namespace FlakyWhy {
  export interface Props {
    reason: Flaky.Reason
    /** The link to a build, shaped like `useClientLink`'s result; none leaves the numbers as text. */
    linkOf?: (build: number) => { href: string; onClick: MouseEventHandler<HTMLElement> }
    /** The screenshot, for the links' labels. */
    name?: string
  }
}

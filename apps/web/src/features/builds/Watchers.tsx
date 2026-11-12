import type { Build } from '@circi/api'
import { Avatar, EyeIcon, Text, Tooltip, visuallyHidden } from '@circi/ui'

import { authClient } from '#lib/auth-client.ts'

import styles from './Watchers.module.css'

/**
 * Who is notified about the build (its author and whoever was asked to review), beside the
 * header's other status chips: an eye and the count, "you're watching" when you are; hovering it
 * lists them, each with their picture. Nothing while nobody watches.
 */
export function Watchers({ watchers }: Watchers.Props) {
  const { data: session } = authClient.useSession()
  if (watchers.length === 0) return null
  const watching = watchers.some((w) => w.id === session?.user.id)
  return (
    <Tooltip
      content={
        <ul className={styles.people}>
          {watchers.map((w) => (
            <li key={w.id} className={styles.person}>
              <Avatar type="user" id={w.id} name={w.name} image={w.image} size={16} />
              {w.name}
              {w.id === session?.user.id ? ' (you)' : ''}
            </li>
          ))}
        </ul>
      }
    >
      {/* Its name is its visible text ("4 · you're watching", or "4 watching"), so what is said
          and what is read match (WCAG 2.5.3). */}
      <button type="button" className={styles.root}>
        <EyeIcon size={14} aria-hidden="true" />
        <Text variant="small" tone="secondary">
          {watchers.length}
          {watching ? " · you're watching" : <span style={visuallyHidden}> watching</span>}
        </Text>
      </button>
    </Tooltip>
  )
}

export namespace Watchers {
  export interface Props {
    watchers: Build.Detail['watchers']
  }
}

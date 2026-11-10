import { Banner, Button } from '@circi/ui'
import { useState } from 'react'

import { shouldAskForPush } from '#lib/prompt-rules.ts'
import { useNow } from '#lib/RelativeTime.tsx'
import { usePwaStore } from '#lib/stores/pwa-store.ts'

import { useTogglePush } from './api.ts'
import { currentPlatform } from './platform.ts'

import styles from './Pwa.module.css'

/**
 * The offer to turn on notifications for this device, in context on Reviews: after a review landed
 * there or after the first approval, never on first load and never as a pop-up. The browser's own
 * permission box appears only after "Turn on notifications". "Not now" asks again after 14 days,
 * at most three times. If the browser's box is declined, the offer gives way to a note that the
 * browser won't ask again.
 */
export function PushPrompt({ hasReview }: PushPrompt.Props) {
  const permission = usePwaStore((s) => s.pushPermission)
  const endpoint = usePwaStore((s) => s.pushEndpoint)
  const approved = usePwaStore((s) => s.approved)
  const dismissals = usePwaStore((s) => s.push)
  const putOff = usePwaStore((s) => s.putOffPush)
  const toggle = useTogglePush()
  const [declined, setDeclined] = useState(false)
  const now = useNow()

  if (declined) {
    return (
      <div className={styles.wrap}>
        <Banner tone="warning" title="Notifications are blocked for this site.">
          Allow them in your browser's site settings to turn them on.
        </Banner>
      </div>
    )
  }
  const platform = currentPlatform()
  const ask = shouldAskForPush({
    permission,
    subscribed: endpoint !== null,
    triggered: hasReview || approved,
    needsInstall: platform.ios && !platform.standalone,
    dismissals,
    now,
  })
  if (!ask) return null
  return (
    <div className={styles.wrap}>
      <Banner
        title="Get notified when a review needs you."
        action={
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="primary"
              loading={toggle.isPending}
              onClick={() =>
                toggle.mutate(true, {
                  onSuccess: (result) => {
                    if (result && !result.ok && result.reason === 'denied') setDeclined(true)
                  },
                })
              }
            >
              Turn on notifications
            </Button>
            <Button size="sm" variant="ghost" onClick={() => putOff(Date.now())}>
              Not now
            </Button>
          </div>
        }
      >
        Pushes on this device only: review requests, mentions and rejections of your builds.
        {toggle.error ? ` ${toggle.error.message}` : ''}
      </Banner>
    </div>
  )
}

export namespace PushPrompt {
  export interface Props {
    /** A review is waiting for the person on this page. */
    hasReview: boolean
  }
}

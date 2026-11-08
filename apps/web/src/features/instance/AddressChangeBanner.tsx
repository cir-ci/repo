import { Banner, Button } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { noticesQuery, useDismissAddressChange } from './api.ts'

import styles from './AddressChangeBanner.module.css'

/** Tells instance admins the dashboard moved to a new address, with what's left to do. */
export function AddressChangeBanner() {
  const { data } = useQuery(noticesQuery())
  const dismiss = useDismissAddressChange()
  const change = data?.publicUrlChange
  if (!change) return null
  return (
    <div className={styles.wrap}>
      <Banner
        tone="warning"
        title={`The dashboard moved from ${change.from} to ${change.to}.`}
        action={
          <Button size="sm" loading={dismiss.isPending} onClick={() => dismiss.mutate()}>
            Done
          </Button>
        }
      >
        <ul className={styles.checklist}>
          {change.checklist.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </Banner>
    </div>
  )
}

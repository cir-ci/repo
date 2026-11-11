import { ListSkeleton, Skeleton } from '@circi/ui'

import styles from './PageSkeleton.module.css'

/**
 * What every lazily loaded page shows while its code loads (the router's pending component): a
 * header bar and list rows, the same rows `QuerySkeleton` shows while a page's data loads, so code
 * then data read as one wait. The router keeps the current page up for its first 300ms
 * (`defaultPendingMs`), so a fast load shows nothing; hence no `Delayed` here.
 */
export function PageSkeleton() {
  return (
    <div aria-busy="true" data-slot="page-skeleton">
      <div className={styles.header} aria-hidden="true">
        <Skeleton width={160} height={14} />
        <span className={styles.spacer} />
        <Skeleton width={96} height={24} />
      </div>
      <ListSkeleton rows={6} />
    </div>
  )
}

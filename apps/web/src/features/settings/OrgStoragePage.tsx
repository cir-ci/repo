import { EmptyState, ListRow, SectionHeader, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'

import { useDocumentTitle } from '../../lib/document-title.ts'
import { formatBytes, storageQuery, storageRows } from './api.ts'
import { Frame } from './Frame.tsx'

import styles from './Settings.module.css'

/**
 * What the organisation's builds take up on disk, per project. Retention is a per-project setting
 * ("Keep builds for N days") and the instance's own limits live on the server, so this page shows
 * numbers and says where to change them.
 */
export function OrgStoragePage() {
  const { org } = useParams({ from: '/organizations/$org/settings/storage' })
  useDocumentTitle('Storage', org)
  const { data, error, refetch } = useQuery(storageQuery(org))
  const rows = data ? storageRows(data.storage) : []

  return (
    <Frame
      crumbs={[data?.org.name ?? org, 'Storage']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This organization doesn’t exist"
    >
      {data ? (
        <>
          <section className={styles['section']}>
            <SectionHeader
              title="Storage"
              description={`${formatBytes(data.storage.totalBytes)} in total. Files shared between builds are counted once per project.`}
            />
            {rows.length === 0 ? (
              <EmptyState title="Nothing stored yet">
                Upload a build to see its size here.
              </EmptyState>
            ) : (
              <ul className={styles['list']} aria-label="Storage by project">
                {rows.map((p) => (
                  <li key={p.slug}>
                    <ListRow density="two-line">
                      <div className={styles['who']}>
                        <div className={styles['row']}>
                          <Link to="/$org/$project/settings" params={{ org, project: p.slug }}>
                            {p.name}
                          </Link>
                          <Text>{formatBytes(p.bytes)}</Text>
                        </div>
                        <div
                          className={styles['bar']}
                          style={{ width: `${Math.max(p.share * 100, 1)}%` }}
                        />
                      </div>
                    </ListRow>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={styles['section']}>
            <SectionHeader title="Retention" />
            <Text tone="secondary">
              How long builds are kept is set per project: open a project’s settings and change
              “Keep builds for (days)”. Server-wide limits, such as upload size and the storage
              driver, are configured on the server, not here.
            </Text>
          </section>
        </>
      ) : null}
    </Frame>
  )
}

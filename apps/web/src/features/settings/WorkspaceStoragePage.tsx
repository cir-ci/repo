import { EmptyState, ListRow, SectionHeader, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'

import { useDocumentTitle } from '#lib/document-title.ts'

import { formatBytes, storageQuery, storageRows } from './api.ts'
import { Frame } from './Frame.tsx'

import styles from './Settings.module.css'

/**
 * What the workspace's builds take up on disk, per team. Retention is a per-team setting
 * ("Keep builds for N days") and the instance's own limits live on the server, so this page shows
 * numbers and says where to change them.
 */
export function WorkspaceStoragePage() {
  const { workspace } = useParams({ from: '/workspaces/$workspace/settings/storage' })
  useDocumentTitle('Storage', workspace)
  const { data, error, refetch } = useQuery(storageQuery(workspace))
  const rows = data ? storageRows(data.storage) : []

  return (
    <Frame
      crumbs={[data?.workspace.name ?? workspace, 'Storage']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This workspace doesn’t exist"
    >
      {data ? (
        <>
          <section className={styles.section}>
            <SectionHeader
              title="Storage"
              description={`${formatBytes(data.storage.totalBytes)} in total. Files shared between builds are counted once per team.`}
            />
            {rows.length === 0 ? (
              <EmptyState title="Nothing stored yet">
                Upload a build to see its size here.
              </EmptyState>
            ) : (
              <ul className={styles.list} aria-label="Storage by team">
                {rows.map((p) => (
                  <li key={p.slug}>
                    <ListRow density="two-line">
                      <div className={styles.who}>
                        <div className={styles.row}>
                          <Link
                            to="/$workspace/$team/settings"
                            params={{ workspace, team: p.slug }}
                          >
                            {p.name}
                          </Link>
                          <Text>{formatBytes(p.bytes)}</Text>
                        </div>
                        <div
                          className={styles.bar}
                          style={{ width: `${Math.max(p.share * 100, 1)}%` }}
                        />
                      </div>
                    </ListRow>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={styles.section}>
            <SectionHeader title="Retention" />
            <Text tone="secondary">
              How long builds are kept is set per team: open a team’s settings and change “Keep
              builds for (days)”. Server-wide limits, such as upload size and the storage driver,
              are configured on the server, not here.
            </Text>
          </section>
        </>
      ) : null}
    </Frame>
  )
}

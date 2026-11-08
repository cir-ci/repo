import type { Baseline } from '@circi/api'
import {
  Breadcrumbs,
  Delayed,
  EmptyState,
  ListRow,
  ListSkeleton,
  PanelHeader,
  Text,
  TextField,
  visuallyHidden,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { fileUrl } from '#features/builds/api.ts'
import { useLoadingAnnouncement } from '#features/teams/loading.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { useClientLink } from '#lib/use-client-link.ts'
import { useListNavigation } from '#lib/use-list-navigation.ts'

import {
  baselineId,
  baselinesQuery,
  countLabel,
  dimensionsLabel,
  filterBaselines,
  flattenGroups,
  groupBaselines,
  sizeLabel,
} from './api.ts'
import { ROUTE } from './routes.ts'

import listStyles from '#lib/ListPage.module.css'
import styles from './BaselinesPage.module.css'

export function BaselinesPage() {
  const { workspace, team } = useParams({ from: ROUTE })
  useDocumentTitle('Baselines', team)
  const clientLink = useClientLink()
  const { data, error, refetch } = useQuery(baselinesQuery(workspace, team))
  useLoadingAnnouncement(!data && !error, 'Loading baselines')
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string>()

  const all = data?.baselines ?? []
  const groups = groupBaselines(filterBaselines(all, filter))
  const items = flattenGroups(groups)

  const { listRef, rowProps } = useListNavigation({
    items,
    getId: baselineId,
    selectedId,
    onSelect: (i: Baseline.Item) => setSelectedId(baselineId(i)),
  })

  return (
    <>
      <PanelHeader>
        <Breadcrumbs items={[{ label: team }, { label: 'Baselines' }]} />
      </PanelHeader>
      <div className={listStyles['page']}>
        <div className={listStyles['body']}>
          {error ? (
            <ErrorState error={error} onRetry={() => void refetch()} notFound="Team not found" />
          ) : !data ? (
            <Delayed>
              <ListSkeleton rows={4} />
            </Delayed>
          ) : all.length === 0 ? (
            <EmptyState title="No baselines yet">
              Once a build of {data.team.defaultBranch} finishes, its screenshots become the
              baselines new builds are compared against.
            </EmptyState>
          ) : (
            <>
              <div className={listStyles['toolbar']}>
                <span role="status" className={listStyles['count']}>
                  {countLabel(items.length, all.length)} on {data.team.defaultBranch}
                </span>
                <TextField
                  className={styles.filter}
                  label="Filter"
                  placeholder="Name, build or commit"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              {items.length === 0 ? (
                <EmptyState title="No matching baselines">
                  Nothing matches “{filter.trim()}”.
                </EmptyState>
              ) : (
                <div className={styles.groups} ref={listRef}>
                  {groups.map((group) => (
                    <section key={group.buildName} aria-labelledby={`baselines-${group.buildName}`}>
                      <h2 className={styles.groupHeader} id={`baselines-${group.buildName}`}>
                        {group.buildName}
                      </h2>
                      <ul
                        aria-label={`${group.buildName}, ${group.items.length} baselines`}
                        className={listStyles['list']}
                      >
                        {group.items.map((item) => (
                          <li key={baselineId(item)} {...rowProps(baselineId(item))}>
                            <ListRow
                              density="two-line"
                              selected={baselineId(item) === selectedId}
                              {...clientLink({
                                to: '/$workspace/$team/builds/$number',
                                params: { workspace, team, number: String(item.buildNumber) },
                              })}
                              leading={
                                item.thumbnailSha256 || item.fileSha256 ? (
                                  <img
                                    className={styles.thumb}
                                    src={fileUrl(item.thumbnailSha256 ?? item.fileSha256)}
                                    alt=""
                                    loading="lazy"
                                  />
                                ) : undefined
                              }
                            >
                              <Text truncate>{item.name}</Text>
                              <span className={listStyles['meta']}>
                                <span>Build #{item.buildNumber}</span>
                                {dimensionsLabel(item) ? (
                                  <span>{dimensionsLabel(item)}</span>
                                ) : null}
                                {sizeLabel(item.sizeBytes) ? (
                                  <span>{sizeLabel(item.sizeBytes)}</span>
                                ) : null}
                                <span>
                                  <span style={visuallyHidden}>Approved </span>
                                  <RelativeTime iso={item.approvedAt} />
                                </span>
                              </span>
                            </ListRow>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

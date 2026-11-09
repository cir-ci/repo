import type { Baseline } from '@circi/api'
import { EmptyState, ListRow, SearchIcon, StatusIcon, Text, TextField } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { useCrumbNames } from '#features/teams/crumb-names.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { useClientLink } from '#lib/use-client-link.ts'
import { useListNavigation } from '#lib/use-list-navigation.ts'

import {
  baselineId,
  baselinesQuery,
  filterBaselines,
  flattenGroups,
  groupBaselines,
} from './api.ts'
import { ROUTE } from './routes.ts'

import styles from './BaselinesPage.module.css'

export function BaselinesPage() {
  const { workspace, team } = useParams({ from: ROUTE })
  const names = useCrumbNames(workspace, team)
  useDocumentTitle('Baselines', team)
  const clientLink = useClientLink()
  const query = useQuery(baselinesQuery(workspace, team))
  const { data } = query
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
      <PageHeading
        crumbs={crumbsFor(names)}
        title="Baselines"
        after={
          data && all.length > 0 ? (
            <Text variant="small" tone="tertiary" role="status">
              {items.length} on {data.team.defaultBranch}
            </Text>
          ) : null
        }
        actions={
          data && all.length > 0 ? (
            <span className={styles.search}>
              <SearchIcon size={14} className={styles.searchIcon} aria-hidden="true" />
              <TextField
                label="Search baselines"
                hideLabel
                placeholder="Search snapshots"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </span>
          ) : null
        }
      />
      <div className={styles.page}>
        <QueryBoundary
          query={query}
          announce="Loading baselines"
          notFound="Team not found"
          rows={4}
        >
          {(loaded) =>
            all.length === 0 ? (
              <EmptyState title="No baselines yet">
                Once a build of {loaded.team.defaultBranch} finishes, its screenshots become the
                baselines new builds are compared against.
              </EmptyState>
            ) : (
              <>
                <div className={styles.cols} aria-hidden="true">
                  <span className={styles.snapshot}>Snapshot</span>
                  <span className={styles.build}>Build</span>
                  <span className={styles.age}>Age</span>
                </div>
                {items.length === 0 ? (
                  <Text as="p" tone="tertiary" className={styles.none}>
                    No baseline matches “{filter.trim()}”
                  </Text>
                ) : (
                  <div className={styles.groups} ref={listRef}>
                    {groups.map((group) => {
                      const title = group.prefix ?? 'Ungrouped'
                      const id = `baselines-${group.prefix ?? '(ungrouped)'}`
                      return (
                        <section key={id} aria-labelledby={id}>
                          <h2 className={styles.groupHeader} id={id}>
                            <span>{title}</span>
                            <span className={styles.groupCount}>{group.items.length}</span>
                          </h2>
                          <ul className={styles.list}>
                            {group.items.map((item) => (
                              <li key={baselineId(item)} {...rowProps(baselineId(item))}>
                                <ListRow
                                  density="compact"
                                  selected={baselineId(item) === selectedId}
                                  {...clientLink({
                                    to: '/$workspace/$team/builds/$number',
                                    params: { workspace, team, number: String(item.buildNumber) },
                                  })}
                                  leading={
                                    <StatusIcon
                                      status="approved"
                                      label={`Baseline on ${loaded.team.defaultBranch}`}
                                    />
                                  }
                                >
                                  <span className={styles.rowGrid}>
                                    <Text truncate className={styles.snapshot}>
                                      {item.name}
                                      {item.buildName === 'default' ? null : (
                                        <span className={styles.buildName}>
                                          {' '}
                                          · {item.buildName}
                                        </span>
                                      )}
                                    </Text>
                                    <span className={styles.build}>#{item.buildNumber}</span>
                                    <span className={styles.age}>
                                      <RelativeTime iso={item.approvedAt} />
                                    </span>
                                  </span>
                                </ListRow>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )
                    })}
                  </div>
                )}
              </>
            )
          }
        </QueryBoundary>
      </div>
    </>
  )
}

import type { Baseline } from '@circi/api'
import { EmptyState, ImageIcon, ListRow, StatusIcon, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { flakyQuery } from '#features/teams/api/index.ts'
import { useCrumbNames } from '#features/teams/crumb-names.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { useFindParam } from '#lib/find.ts'
import { FindField, NoMatches } from '#lib/FindField.tsx'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { Age } from '#lib/RelativeTime.tsx'
import { useClientLink } from '#lib/use-client-link.ts'
import { useListNavigation } from '#lib/use-list-navigation.ts'

import {
  baselineId,
  baselinesQuery,
  filterBaselines,
  flattenGroups,
  groupBaselines,
} from './api.ts'
import { baselineLink } from './links.ts'
import { ROUTE } from './routes.ts'

import styles from './BaselinesPage.module.css'

export function BaselinesPage() {
  const { workspace, team } = useParams({ from: ROUTE })
  const names = useCrumbNames(workspace, team)
  useDocumentTitle('Baselines', team)
  const clientLink = useClientLink()
  const query = useQuery(baselinesQuery(workspace, team))
  const { data } = query
  const flaky = useQuery(flakyQuery(workspace, team))
  const flakyOf = new Map((flaky.data?.flaky ?? []).map((f) => [f.name, f.changedIn]))
  const [filter, setFilter] = useFindParam()
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
            <FindField noun="baselines" value={filter} onChange={setFilter} />
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
              <div className={styles.empty}>
                <EmptyState icon={<ImageIcon size={32} />} title="No baselines yet">
                  Once a build of {loaded.team.defaultBranch} finishes, its screenshots become the
                  baselines new builds are compared against.
                </EmptyState>
              </div>
            ) : (
              <>
                <div className={styles.cols} aria-hidden="true">
                  <span className={styles.snapshot}>Screenshot</span>
                  <span className={styles.build}>Build</span>
                  <span className={styles.age}>Age</span>
                  <span className={styles.flag} />
                </div>
                {items.length === 0 ? (
                  <NoMatches noun="baselines" query={filter} />
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
                              <li
                                key={baselineId(item)}
                                className={styles.item}
                                {...rowProps(baselineId(item))}
                              >
                                <ListRow
                                  density="compact"
                                  selected={baselineId(item) === selectedId}
                                  className={styles.rowLink}
                                  {...clientLink(baselineLink(workspace, team, item.name))}
                                  leading={
                                    <StatusIcon
                                      status="approved"
                                      label={`Baseline on ${loaded.team.defaultBranch}`}
                                    />
                                  }
                                >
                                  <Text truncate>
                                    {item.name}
                                    {item.buildName === 'default' ? null : (
                                      <span className={styles.buildName}> · {item.buildName}</span>
                                    )}
                                  </Text>
                                </ListRow>
                                <a
                                  className={styles.buildLink}
                                  aria-label={`Build #${item.buildNumber}, the build this baseline came from`}
                                  {...clientLink({
                                    to: '/$workspace/$team/builds/$number',
                                    params: { workspace, team, number: String(item.buildNumber) },
                                  })}
                                >
                                  #{item.buildNumber}
                                </a>
                                <span className={styles.age}>
                                  <Age iso={item.approvedAt} />
                                </span>
                                <span className={styles.flag}>
                                  {flakyOf.has(item.name) ? (
                                    <StatusIcon
                                      status="flaky"
                                      label={`Flaky: changed in ${flakyOf.get(item.name)} of the last ${flaky.data?.builds} builds`}
                                    />
                                  ) : null}
                                </span>
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

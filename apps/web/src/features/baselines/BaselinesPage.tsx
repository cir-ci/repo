import type { Baseline } from '@circi/api'
import { EmptyState, ImagesIcon, ListGroup, ListRow, NoResults, StatusIcon, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { flakyQuery } from '#features/teams/api/index.ts'
import { useCrumbNames } from '#features/teams/crumb-names.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { useFindParam } from '#lib/find.ts'
import { FindField } from '#lib/FindField.tsx'
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
  const router = useRouter()
  const query = useQuery(baselinesQuery(workspace, team))
  const { data } = query
  const flaky = useQuery(flakyQuery(workspace, team))
  const flakyOf = new Map((flaky.data?.flaky ?? []).map((f) => [f.name, f.reason]))
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
                <EmptyState icon={<ImagesIcon />} title="No baselines yet">
                  Once a build of {loaded.team.defaultBranch} finishes, its screenshots become the
                  baselines.
                </EmptyState>
              </div>
            ) : (
              <>
                {items.length === 0 ? (
                  <div className={styles.empty}>
                    <NoResults noun="baseline" query={filter} onClear={() => setFilter('')} />
                  </div>
                ) : (
                  <div className={styles.groups} ref={listRef}>
                    {groups.map((group) => {
                      const title = group.prefix ?? 'Ungrouped'
                      const id = `baselines-${group.prefix ?? '(ungrouped)'}`
                      return (
                        <section key={id} aria-labelledby={id}>
                          <ListGroup id={id} label={title} count={group.items.length} />
                          <ul className={styles.list}>
                            {group.items.map((item) => (
                              <li key={baselineId(item)} {...rowProps(baselineId(item))}>
                                <ListRow
                                  selected={baselineId(item) === selectedId}
                                  {...clientLink(baselineLink(workspace, team, item.name))}
                                  leading={
                                    <StatusIcon
                                      status="approved"
                                      label={`Baseline on ${loaded.team.defaultBranch}`}
                                    />
                                  }
                                  title={
                                    <>
                                      {item.name}
                                      {item.buildName === 'default' ? null : (
                                        <span className={styles.buildName}>
                                          {' '}
                                          · {item.buildName}
                                        </span>
                                      )}
                                    </>
                                  }
                                  subtitle={`Build #${item.buildNumber}`}
                                  action={{
                                    label: `Open build #${item.buildNumber} ↗`,
                                    onAction: () =>
                                      void router.navigate({
                                        to: '/$workspace/$team/builds/$number',
                                        params: {
                                          workspace,
                                          team,
                                          number: String(item.buildNumber),
                                        },
                                      }),
                                  }}
                                  trailing={
                                    <>
                                      {flakyOf.has(item.name) ? (
                                        <StatusIcon
                                          status="flaky"
                                          label={`Flaky: ${flakyOf.get(item.name)}`}
                                        />
                                      ) : null}
                                      <span className={styles.age}>
                                        <Age iso={item.approvedAt} />
                                      </span>
                                    </>
                                  }
                                />
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

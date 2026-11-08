import {
  Breadcrumbs,
  Delayed,
  EmptyState,
  ListSkeleton,
  PanelHeader,
  SegmentedControl,
  Select,
  Text,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'

import { useDocumentTitle } from '../../lib/document-title.ts'
import { ErrorState } from '../../lib/ErrorState.tsx'
import { useLoadingAnnouncement } from '../projects/loading.ts'
import { useSidebarModel } from '../sidebar/api.ts'
import {
  formatBytes,
  formatHours,
  insightsQuery,
  isEmpty,
  type InsightsSearch,
  RANGE_OPTIONS,
  parseRange,
  tiles,
} from './api.ts'
import { storageBars } from './chart.ts'
import { FlakyChart, ReviewChart } from './Charts.tsx'
import { ROUTE } from './routes.ts'

import styles from './Insights.module.css'

const ALL = '__all__'

export function InsightsPage() {
  const { org } = useParams({ from: ROUTE })
  const search = useSearch({ from: ROUTE })
  const navigate = useNavigate()
  useDocumentTitle('Insights', org)
  const { data, error, refetch } = useQuery(insightsQuery(org, search))
  useLoadingAnnouncement(!data && !error, 'Loading insights')
  const { data: sidebar } = useSidebarModel(org)

  const go = (next: InsightsSearch) => void navigate({ to: ROUTE, params: { org }, search: next })
  const projects = sidebar?.projects ?? []
  const projectItems = [
    { value: ALL, label: 'All projects' },
    ...projects.map((p) => ({ value: p.slug, label: p.name })),
  ]
  if (search.project && !projects.some((p) => p.slug === search.project)) {
    projectItems.push({ value: search.project, label: search.project })
  }

  return (
    <>
      <PanelHeader
        actions={
          <div className={styles['filters']}>
            <Select
              label="Project"
              hideLabel
              items={projectItems}
              value={search.project ?? ALL}
              onValueChange={(v) =>
                go({ range: search.range, ...(v === ALL ? {} : { project: v }) })
              }
            />
            <SegmentedControl
              label="Time range"
              options={RANGE_OPTIONS}
              value={String(search.range)}
              onChange={(v) => go({ ...search, range: parseRange(v) })}
            />
          </div>
        }
      >
        <Breadcrumbs items={[{ label: org }, { label: 'Insights' }]} />
      </PanelHeader>
      <div className={styles['body']}>
        {error ? (
          <ErrorState
            error={error}
            onRetry={() => void refetch()}
            notFound="Organization not found"
          />
        ) : !data ? (
          <Delayed>
            <ListSkeleton rows={4} />
          </Delayed>
        ) : isEmpty(data) ? (
          <EmptyState title="No data yet">
            Nothing was built or reviewed in the last {search.range} days. Try a longer range.
          </EmptyState>
        ) : (
          <>
            <ul className={styles['tiles']} aria-label="Summary">
              {tiles(data, search.range).map((t) => (
                <li key={t.id} className={styles['tile']}>
                  <Text variant="small" tone="secondary">
                    {t.title}
                  </Text>
                  <span className={styles['value']}>{t.value}</span>
                  <span
                    className={styles['pill']}
                    data-tone={t.delta.tone}
                    aria-label={t.delta.label}
                  >
                    {t.delta.text}
                  </span>
                  <Text variant="small" tone="secondary">
                    {t.note}
                  </Text>
                </li>
              ))}
            </ul>
            <div className={styles['grid']}>
              <section className={styles['card']} aria-labelledby="ins-review">
                <h2 id="ins-review">Median time to review, per week</h2>
                <ReviewChart weeks={data.weeks} />
              </section>
              <section className={styles['card']} aria-labelledby="ins-flaky">
                <h2 id="ins-flaky">Flaky snapshots</h2>
                <FlakyChart weeks={data.weeks} />
              </section>
              <section className={styles['card']} aria-labelledby="ins-storage">
                <h2 id="ins-storage">Storage by project</h2>
                <Text variant="small" tone="secondary">
                  {formatBytes(data.storage.totalBytes)} total
                </Text>
                <ul className={styles['list']}>
                  {storageBars(data.storage).map((p) => (
                    <li key={p.slug} className={styles['hbar']}>
                      <span>{p.name}</span>
                      <div className={styles['track']} aria-hidden="true">
                        <div className={styles['fill']} style={{ width: `${p.share * 100}%` }} />
                      </div>
                      <span className={styles['num']}>{formatBytes(p.bytes)}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className={styles['card']} aria-labelledby="ins-who">
                <h2 id="ins-who">Reviewer load</h2>
                {data.reviewers.length === 0 ? (
                  <Text variant="small" tone="secondary">
                    No reviewers yet.
                  </Text>
                ) : (
                  <table className={styles['table']}>
                    <thead>
                      <tr>
                        <th scope="col">Reviewer</th>
                        <th scope="col">Reviews</th>
                        <th scope="col">Open</th>
                        <th scope="col">Median response</th>
                        <th scope="col">Overdue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.reviewers.map((r) => (
                        <tr key={r.id}>
                          <td>{r.name}</td>
                          <td>{r.reviews}</td>
                          <td>{r.openRequests}</td>
                          <td>{formatHours(r.medianResponseHours)}</td>
                          <td>{r.overdue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </>
  )
}

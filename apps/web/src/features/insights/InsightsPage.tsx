import {
  Avatar,
  ChartNoAxesColumnIcon,
  EmptyState,
  SegmentedControl,
  Select,
  Text,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { useCrumbNames } from '#features/teams/crumb-names.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'

import {
  formatBytes,
  formatHours,
  insightsQuery,
  isEmpty,
  type InsightsSearch,
  RANGE_OPTIONS,
  parseRange,
  retentionSpan,
  tiles,
} from './api.ts'
import { flakyDelta, storageBars } from './chart.ts'
import { FlakyChart, ReviewChart } from './Charts.tsx'
import { ROUTE } from './routes.ts'

import styles from './Insights.module.css'

const ALL = '__all__'

export function InsightsPage() {
  const { workspace } = useParams({ from: ROUTE })
  const search = useSearch({ from: ROUTE })
  const navigate = useNavigate()
  useDocumentTitle('Insights', workspace)
  const query = useQuery(insightsQuery(workspace, search))
  const { data: sidebar } = useSidebarModel(workspace)
  const names = useCrumbNames(workspace)

  const go = (next: InsightsSearch) =>
    void navigate({ to: ROUTE, params: { workspace }, search: next })
  const teams = sidebar?.teams ?? []
  const teamItems = [
    { value: ALL, label: 'All teams' },
    ...teams.map((p) => ({ value: p.slug, label: p.name })),
  ]
  if (search.team && !teams.some((p) => p.slug === search.team)) {
    teamItems.push({ value: search.team, label: search.team })
  }

  return (
    <>
      <PageHeading
        crumbs={crumbsFor(names)}
        title="Insights"
        actions={
          <div className={styles.filters}>
            <Select
              label="Team"
              hideLabel
              items={teamItems}
              value={search.team ?? ALL}
              onValueChange={(v) => go({ range: search.range, ...(v === ALL ? {} : { team: v }) })}
            />
            <SegmentedControl
              label="Time range"
              options={RANGE_OPTIONS}
              value={String(search.range)}
              onChange={(v) => go({ ...search, range: parseRange(v) })}
            />
          </div>
        }
      />
      <div className={styles.body}>
        <QueryBoundary
          query={query}
          announce="Loading insights"
          notFound="Workspace not found"
          rows={4}
        >
          {(data) => {
            const flaky = flakyDelta(data.weeks)
            return isEmpty(data) ? (
              <EmptyState icon={<ChartNoAxesColumnIcon />} title="No data yet">
                Nothing was built or reviewed in the last {search.range} days. Try a longer range.
              </EmptyState>
            ) : (
              <>
                <ul className={styles.tiles} aria-label="Summary">
                  {tiles(data, search.range).map((t) => (
                    <li key={t.id} className={styles.tile}>
                      <Text variant="small" tone="secondary">
                        {t.title}
                      </Text>
                      <span className={styles.value}>{t.value}</span>
                      <span
                        className={styles.pill}
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
                <div className={styles.grid}>
                  <section className={styles.card} aria-labelledby="ins-review">
                    <div className={styles.head}>
                      <h2 id="ins-review">Median time to review, per week</h2>
                      <span className={styles.sub}>hours</span>
                    </div>
                    <ReviewChart weeks={data.weeks} goalHours={data.reviewTargetHours} />
                  </section>
                  <section className={styles.card} aria-labelledby="ins-flaky">
                    <div className={styles.head}>
                      <h2 id="ins-flaky">Flaky screenshots</h2>
                      <span className={styles.sub}>open, end of each week</span>
                      {flaky ? (
                        <span
                          className={styles.pill}
                          data-tone={flaky.tone}
                          aria-label={flaky.label}
                        >
                          {flaky.text}
                        </span>
                      ) : null}
                    </div>
                    <FlakyChart weeks={data.weeks} />
                    <div className={styles.legend}>
                      <span>
                        <i style={{ background: 'var(--circi-state-approved)' }} />
                        fewer flaky (better)
                      </span>
                      <span>
                        <i style={{ background: 'var(--circi-state-failed)' }} />
                        more flaky (worse)
                      </span>
                      <span>
                        <i style={{ background: 'var(--circi-text-tertiary)' }} />
                        no change
                      </span>
                    </div>
                    {data.flakyAfterChanges !== null ? (
                      <Text variant="small" tone="secondary">
                        Flaky means changed in {data.flakyAfterChanges} of the last 10
                        default-branch builds.
                      </Text>
                    ) : null}
                  </section>
                  <section className={styles.card} aria-labelledby="ins-who">
                    <div className={styles.head}>
                      <h2 id="ins-who">Reviewer load</h2>
                      <span className={styles.sub}>last {search.range} days</span>
                    </div>
                    {data.reviewers.length === 0 ? (
                      <Text variant="small" tone="secondary">
                        No reviewers yet.
                      </Text>
                    ) : (
                      <table className={styles.table}>
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
                              <td>
                                <span className={styles.person}>
                                  <Avatar type="user" id={r.id} name={r.name} image={r.image} />
                                  {r.name}
                                </span>
                              </td>
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
                  <section className={styles.card} aria-labelledby="ins-storage">
                    <div className={styles.head}>
                      <h2 id="ins-storage">Storage by team</h2>
                      <span className={styles.sub}>
                        screenshots, diffs and baselines · {formatBytes(data.storage.totalBytes)}{' '}
                        total
                      </span>
                    </div>
                    <ul className={styles.list}>
                      {storageBars(data.storage).map((p) => (
                        <li key={p.slug} className={styles.hbar}>
                          <span>{p.name}</span>
                          <div className={styles.track} aria-hidden="true">
                            <div className={styles.fill} style={{ width: `${p.share * 100}%` }} />
                          </div>
                          <span className={styles.num}>{formatBytes(p.bytes)}</span>
                        </li>
                      ))}
                    </ul>
                    {data.retentionDays ? (
                      <Text variant="small" tone="secondary">
                        Retention keeps {retentionSpan(data.retentionDays)} of branch builds.
                      </Text>
                    ) : null}
                  </section>
                </div>
              </>
            )
          }}
        </QueryBoundary>
      </div>
    </>
  )
}

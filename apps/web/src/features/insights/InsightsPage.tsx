import { ChartNoAxesColumnIcon, EmptyState, SegmentedControl, Select } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'

import { useCrumbNames } from '#features/projects/crumb-names.ts'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'

import {
  insightsQuery,
  isEmpty,
  type InsightsSearch,
  RANGE_OPTIONS,
  parseRange,
  tiles,
} from './api.ts'
import { Pill } from './Card.tsx'
import {
  BacklogCard,
  DecisionCard,
  FailedCard,
  FlakyCard,
  OutcomesCard,
  ProcessingCard,
  ReviewCard,
} from './Charts.tsx'
import {
  FailureReasonsCard,
  FlakiestCard,
  IgnoreRegionsCard,
  MostChangedCard,
  MostRejectedCard,
  OldestWaitingCard,
  RejectionReasonsCard,
  ReviewerLoadCard,
  StorageCard,
  ProjectsCard,
} from './Lists.tsx'
import { ROUTE } from './routes.ts'
import { InsightsSort } from './sort.tsx'

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
      <PageHeading
        crumbs={crumbsFor(names)}
        title="Insights"
        actions={
          <div className={styles.filters}>
            <Select
              label="Project"
              hideLabel
              items={projectItems}
              value={search.project ?? ALL}
              onValueChange={(v) =>
                go({
                  range: search.range,
                  ...(v === ALL ? {} : { project: v }),
                  ...(search.sort ? { sort: search.sort } : {}),
                })
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
      />
      <div className={styles.body}>
        <QueryBoundary
          query={query}
          announce="Loading insights"
          notFound="Workspace not found"
          rows={4}
        >
          {(data) =>
            isEmpty(data) ? (
              <EmptyState icon={<ChartNoAxesColumnIcon />} title="No data yet">
                Nothing was built or reviewed in the last {search.range} days. Try a longer range.
              </EmptyState>
            ) : (
              <InsightsSort
                text={search.sort}
                onChange={(sort) =>
                  void navigate({
                    to: ROUTE,
                    params: { workspace },
                    search: { ...search, sort },
                    replace: true,
                  })
                }
              >
                <ul className={styles.tiles} aria-label="Summary">
                  {tiles(data, search.range).map((t) => (
                    <li key={t.id} className={styles.tile}>
                      <span className={styles.tileLabel}>{t.title}</span>
                      <span className={styles.tileRow}>
                        <span className={styles.value}>{t.value}</span>
                        <Pill {...t.delta} />
                      </span>
                      <span className={styles.tileNote}>{t.note}</span>
                    </li>
                  ))}
                </ul>
                <h2 className={styles.section}>Trends</h2>
                <div className={styles.grid}>
                  <ReviewCard data={data} />
                  <DecisionCard data={data} />
                  <OutcomesCard data={data} />
                  <BacklogCard data={data} />
                </div>
                <div className={styles.grid3}>
                  <FlakyCard data={data} />
                  <FailedCard data={data} days={search.range} />
                  <ProcessingCard data={data} />
                </div>
                <h2 className={styles.section}>Breakdowns</h2>
                <div className={styles.grid1}>
                  <ProjectsCard data={data} days={search.range} />
                </div>
                <div className={styles.grid}>
                  <FailureReasonsCard data={data} />
                  <RejectionReasonsCard data={data} />
                  <IgnoreRegionsCard data={data} days={search.range} />
                  <StorageCard data={data} />
                </div>
                <div className={styles.grid1}>
                  <ReviewerLoadCard data={data} days={search.range} />
                </div>
                <h2 className={styles.section}>Lists</h2>
                <div className={styles.grid}>
                  <MostChangedCard data={data} days={search.range} />
                  <FlakiestCard data={data} />
                  <OldestWaitingCard data={data} />
                  <MostRejectedCard data={data} days={search.range} />
                </div>
              </InsightsSort>
            )
          }
        </QueryBoundary>
      </div>
    </>
  )
}

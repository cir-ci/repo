import type { Insights } from '@circi/api'
import { flakyReasonText } from '@circi/core'
import { Avatar, SortableHeader, StatusIcon, Text } from '@circi/ui'

import { baselineLink } from '#features/baselines/links.ts'
import { Age } from '#lib/RelativeTime.tsx'
import type { Accessors } from '#lib/sort.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import {
  formatBytes,
  formatCount,
  formatHours,
  formatPercent,
  formatWait,
  rangeLabel,
  rejectionsLabel,
  retentionSpan,
} from './api.ts'
import { Card, TableWrap, ProjectChip } from './Card.tsx'
import { shares, storageBars, stripCells, stripLabel } from './chart.ts'
import { useSortedTable } from './sort.tsx'

import styles from './Insights.module.css'

/** The project colour a bar or fill takes (`data-colour` carries the token name). */
const Fill = ({ colour, share }: { colour: string; share: number }) => (
  <span className={styles.track} aria-hidden="true">
    <i className={styles.fill} data-colour={colour} style={{ width: `${share * 100}%` }} />
  </span>
)

function ShotLink(props: { workspace: string; project: string; name: string }) {
  const clientLink = useClientLink()
  return (
    <a
      className={styles.link}
      {...clientLink(baselineLink(props.workspace, props.project, props.name))}
    >
      {props.name}
    </a>
  )
}

function BuildLink(props: { workspace: string; project: string; number: number }) {
  const clientLink = useClientLink()
  return (
    <a
      className={styles.link}
      {...clientLink({
        to: '/$workspace/$project/builds/$number',
        params: {
          workspace: props.workspace,
          project: props.project,
          number: String(props.number),
        },
      })}
    >
      #{props.number}
    </a>
  )
}

/** Ten small cells, oldest left: filled where the screenshot counted against it. */
function Strip({ last10, kind }: { last10: boolean[]; kind: 'changed' | 'flaky' }) {
  return (
    <span
      className={styles.strip}
      role="img"
      aria-label={stripLabel(last10, kind)}
      data-kind={kind}
    >
      {stripCells(last10).map((on, i) => (
        <i
          // oxlint-disable-next-line react/no-array-index-key -- the cells are positions
          key={i}
          data-on={on === null ? undefined : on}
          data-missing={on === null ? '' : undefined}
        />
      ))}
    </span>
  )
}

type ProjectRow = Insights.Report['projectsComparison'][number]
type ReviewerRow = Insights.Report['reviewers'][number]
type ChangedRow = Insights.Report['mostChanged'][number]
type FlakyRow = Insights.Report['flakiest'][number]
type WaitingRow = Insights.Report['oldestWaiting'][number]
type RejectedRow = Insights.Report['mostRejected'][number]

const lit = (flags: boolean[]) => flags.filter(Boolean).length

const PROJECT_COLUMNS: Accessors<ProjectRow> = {
  project: (r) => r.project.name,
  builds: (r) => r.builds,
  changes: (r) => r.buildsWithChanges,
  review: (r) => r.medianReviewHours,
  flaky: (r) => r.flaky,
  failed: (r) => r.failed,
}
const REVIEWER_COLUMNS: Accessors<ReviewerRow> = {
  reviewer: (r) => r.name,
  reviews: (r) => r.reviews,
  open: (r) => r.openRequests,
  response: (r) => r.medianResponseHours,
  overdue: (r) => r.overdue,
}
const CHANGED_COLUMNS: Accessors<ChangedRow> = {
  screenshot: (r) => r.name,
  project: (r) => r.project.name,
  changed: (r) => r.changedBuilds,
  last10: (r) => lit(r.last10),
}
const FLAKY_COLUMNS: Accessors<FlakyRow> = {
  screenshot: (r) => r.name,
  project: (r) => r.project.name,
  flips: (r) => r.flipFlops,
  last10: (r) => lit(r.last10),
}
const WAITING_COLUMNS: Accessors<WaitingRow> = {
  build: (r) => r.number,
  project: (r) => r.project.name,
  branch: (r) => r.branch,
  author: (r) => r.author,
  // The wait is the time since the build was ready: the oldest ready build has waited longest.
  waiting: (r) => -Date.parse(r.readyAt),
}
const REJECTED_COLUMNS: Accessors<RejectedRow> = {
  screenshot: (r) => r.name,
  project: (r) => r.project.name,
  rejected: (r) => r.rejections,
}

export function ProjectsCard({ data, days }: { data: Insights.Report; days: number }) {
  const all = data.projectsComparison
  const table = useSortedTable('projects', all, PROJECT_COLUMNS)
  const rows = table.rows
  if (all.length < 2 || all.every((r) => r.builds === 0)) return null
  const bars = new Map(all.map((r, i) => [r, shares(all, (x) => x.builds)[i] ?? 0]))
  return (
    <Card title="Activity by project" subtitle={rangeLabel(days)} wide>
      <TableWrap>
        <table className={`${styles.table} ${styles.spread}`}>
          <thead>
            <tr>
              <SortableHeader scope="col" {...table.header('project')}>
                Project
              </SortableHeader>
              <SortableHeader scope="col" className={styles.bars150} {...table.header('builds')}>
                Builds
              </SortableHeader>
              <SortableHeader scope="col" className={styles.n} numeric {...table.header('changes')}>
                With changes
              </SortableHeader>
              <SortableHeader scope="col" className={styles.n} numeric {...table.header('review')}>
                Median review
              </SortableHeader>
              <SortableHeader scope="col" className={styles.n} numeric {...table.header('flaky')}>
                Flaky now
              </SortableHeader>
              <SortableHeader scope="col" className={styles.n} numeric {...table.header('failed')}>
                Failed
              </SortableHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const over =
                r.medianReviewHours !== null &&
                r.reviewTargetHours !== null &&
                r.medianReviewHours > r.reviewTargetHours
              return (
                <tr key={r.project.slug}>
                  <th scope="row">
                    <span className={styles.person}>
                      <ProjectChip project={r.project} />
                      {r.project.name}
                    </span>
                  </th>
                  <td className={styles.bars150}>
                    <span className={styles.barNum}>
                      <span className={styles.mini}>
                        <Fill colour={r.project.colour} share={bars.get(r) ?? 0} />
                      </span>
                      <span className={styles.num}>{formatCount(r.builds)}</span>
                    </span>
                  </td>
                  <td className={styles.n}>
                    {formatCount(r.buildsWithChanges)}
                    {r.builds > 0 ? ` (${formatPercent(r.buildsWithChanges / r.builds)})` : ''}
                  </td>
                  <td className={styles.n} data-over={over ? '' : undefined}>
                    {formatHours(r.medianReviewHours)}
                  </td>
                  <td className={styles.n}>{formatCount(r.flaky)}</td>
                  <td className={styles.n}>{formatCount(r.failed)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableWrap>
      <Text variant="small" tone="tertiary">
        Review times past the target are shown in red.
      </Text>
    </Card>
  )
}

export function FailureReasonsCard({ data }: { data: Insights.Report }) {
  const total = data.summary.failedBuilds
  const rows = data.failureReasons
  const bars = shares(rows, (r) => r.builds)
  return (
    <Card
      title="Why builds failed"
      subtitle={`${formatCount(total)} failed ${total === 1 ? 'build' : 'builds'}, grouped by message`}
      empty={rows.length === 0 ? 'No builds failed in this range.' : undefined}
    >
      <ul className={styles.rows}>
        {rows.map((r, i) => (
          <li key={r.message} className={styles.reasonRow} title={r.message}>
            <span className={styles.wrap}>{r.message}</span>
            <span className={styles.track} aria-hidden="true">
              <i
                className={styles.fill}
                data-fill="failed"
                style={{ width: `${(bars[i] ?? 0) * 100}%` }}
              />
            </span>
            <span className={styles.count}>
              {formatCount(r.builds)}{' '}
              <span className={styles.faint}>
                {formatPercent(total === 0 ? null : r.builds / total)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function RejectionReasonsCard({ data }: { data: Insights.Report }) {
  const { rejectedBuilds, withReason, recent } = data.rejections
  const empty =
    rejectedBuilds === 0
      ? 'No rejections in this range.'
      : withReason === 0
        ? `${formatCount(rejectedBuilds)} ${rejectedBuilds === 1 ? 'build was' : 'builds were'} rejected, none with a reason.`
        : undefined
  return (
    <Card
      title="Rejection reasons"
      subtitle={`${formatCount(rejectedBuilds)} rejected ${rejectedBuilds === 1 ? 'build' : 'builds'}, ${formatCount(withReason)} with a reason`}
      empty={empty}
    >
      <ul className={styles.rows}>
        {recent.map((r) => (
          <li key={r.buildId} className={styles.reason}>
            <StatusIcon status="rejected" size={14} />
            <div>
              <p className={styles.reasonText}>{r.reason}</p>
              <p className={styles.reasonMeta}>
                {r.reviewer === null ? null : (
                  <>
                    <span className={styles.person}>
                      <Avatar
                        type="user"
                        id={r.reviewer}
                        name={r.reviewer}
                        image={null}
                        size={16}
                      />
                      {r.reviewer}
                    </span>{' '}
                    ·{' '}
                  </>
                )}
                <BuildLink
                  workspace={data.workspace.slug}
                  project={r.project.slug}
                  number={r.number}
                />{' '}
                · {r.project.name} · <Age iso={r.at} /> ago
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function IgnoreRegionsCard({ data, days }: { data: Insights.Report; days: number }) {
  const effect = data.ignoreRegions
  if (effect === null) return null
  const bars = shares(effect.top, (r) => r.diffs)
  return (
    <Card title="Ignore regions" subtitle={`diffs kept unchanged, ${rangeLabel(days)}`}>
      <p className={styles.figure}>
        <strong>{formatCount(effect.suppressedDiffs)}</strong>
        <span>
          {effect.suppressedDiffs === 0
            ? 'Ignore regions suppressed no changes in this range.'
            : 'screenshots would have changed without them'}
        </span>
      </p>
      <ul className={styles.hbars}>
        {effect.top.map((r, i) => (
          <li key={`${r.project.slug}/${r.region}`} className={styles.hbar}>
            <span className={styles.label} title={r.region}>
              <ProjectChip project={r.project} />
              <span className={styles.ell}>{r.region}</span>
            </span>
            <Fill colour={r.project.colour} share={bars[i] ?? 0} />
            <span className={styles.num}>{formatCount(r.diffs)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function ReviewerLoadCard({ data, days }: { data: Insights.Report; days: number }) {
  const table = useSortedTable('reviewers', data.reviewers, REVIEWER_COLUMNS)
  const barValues = shares(data.reviewers, (r) => r.reviews)
  const bars = new Map(data.reviewers.map((r, i) => [r, barValues[i] ?? 0]))
  return (
    <Card
      title="Reviewer load"
      subtitle={rangeLabel(days)}
      empty={data.reviewers.length === 0 ? 'No reviewers yet.' : undefined}
    >
      <TableWrap>
        <table className={`${styles.table} ${styles.spread}`}>
          <thead>
            <tr>
              <SortableHeader scope="col" {...table.header('reviewer')}>
                Reviewer
              </SortableHeader>
              <SortableHeader scope="col" className={styles.bars150} {...table.header('reviews')}>
                Reviews
              </SortableHeader>
              <SortableHeader scope="col" className={styles.n} numeric {...table.header('open')}>
                Open
              </SortableHeader>
              <SortableHeader
                scope="col"
                className={styles.n}
                numeric
                {...table.header('response')}
              >
                Median response
              </SortableHeader>
              <SortableHeader scope="col" className={styles.n} numeric {...table.header('overdue')}>
                Overdue
              </SortableHeader>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  <span className={styles.person}>
                    <Avatar type="user" id={r.id} name={r.name} image={r.image} size={20} />
                    {r.name}
                  </span>
                </th>
                <td className={styles.bars150}>
                  <span className={styles.barNum}>
                    <span className={styles.mini}>
                      <span className={styles.track} aria-hidden="true">
                        <i
                          className={styles.fill}
                          style={{ width: `${(bars.get(r) ?? 0) * 100}%` }}
                        />
                      </span>
                    </span>
                    <span className={styles.num}>{formatCount(r.reviews)}</span>
                  </span>
                </td>
                <td className={styles.n}>{formatCount(r.openRequests)}</td>
                <td className={styles.n}>{formatHours(r.medianResponseHours)}</td>
                <td className={styles.n}>
                  {r.overdue > 0 ? (
                    <span className={styles.pill} data-tone="bad">
                      {r.overdue}
                    </span>
                  ) : (
                    r.overdue
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  )
}

export function StorageCard({ data }: { data: Insights.Report }) {
  return (
    <Card
      title="Storage by project"
      subtitle={`screenshots, diffs and baselines · ${formatBytes(data.storage.totalBytes)} total`}
    >
      <ul className={styles.hbars}>
        {storageBars(data.storage).map((p) => (
          <li key={p.slug} className={styles.hbar}>
            <span className={styles.label} title={p.name}>
              <span className={styles.ell}>{p.name}</span>
            </span>
            <Fill colour={p.colour} share={p.share} />
            <span className={styles.num}>{formatBytes(p.bytes)}</span>
          </li>
        ))}
      </ul>
      {data.retentionDays ? (
        <Text variant="small" tone="secondary">
          Retention keeps {retentionSpan(data.retentionDays)} of branch builds.
        </Text>
      ) : null}
    </Card>
  )
}

export function MostChangedCard({ data, days }: { data: Insights.Report; days: number }) {
  const table = useSortedTable('changed', data.mostChanged, CHANGED_COLUMNS)
  const rows = table.rows
  const showProject = data.project === null
  return (
    <Card
      title="Most changed screenshots"
      subtitle={`builds with a change, ${rangeLabel(days)}`}
      empty={rows.length === 0 ? 'No screenshots changed in this range.' : undefined}
    >
      <TableWrap>
        <table className={styles.table}>
          <thead>
            <tr>
              <SortableHeader scope="col" {...table.header('screenshot')}>
                Screenshot
              </SortableHeader>
              {showProject ? (
                <SortableHeader scope="col" {...table.header('project')}>
                  Project
                </SortableHeader>
              ) : null}
              <SortableHeader scope="col" className={styles.n} numeric {...table.header('changed')}>
                Changed in
              </SortableHeader>
              <SortableHeader scope="col" className={styles.n} numeric {...table.header('last10')}>
                Last 10 commits
              </SortableHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.project.slug}/${r.name}`}>
                <th scope="row">
                  <ShotLink
                    workspace={data.workspace.slug}
                    project={r.project.slug}
                    name={r.name}
                  />
                </th>
                {showProject ? (
                  <td>
                    <ProjectChip project={r.project} />
                  </td>
                ) : null}
                <td className={styles.n}>
                  {formatCount(r.changedBuilds)} of {formatCount(r.builds)} builds
                </td>
                <td className={styles.n}>
                  <span className={styles.stripCell}>
                    <Strip last10={r.last10} kind="changed" />
                    {r.last10.filter(Boolean).length} of {Math.min(10, r.last10.length)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  )
}

export function FlakiestCard({ data }: { data: Insights.Report }) {
  const table = useSortedTable('flakiest', data.flakiest, FLAKY_COLUMNS)
  const rows = table.rows
  const showProject = data.project === null
  return (
    <Card
      title="Flakiest screenshots"
      subtitle="default branch, last 10 commits"
      empty={rows.length === 0 ? 'No flaky screenshots.' : undefined}
    >
      <TableWrap>
        <table className={styles.table}>
          <thead>
            <tr>
              <SortableHeader scope="col" {...table.header('screenshot')}>
                Screenshot
              </SortableHeader>
              {showProject ? (
                <SortableHeader scope="col" {...table.header('project')}>
                  Project
                </SortableHeader>
              ) : null}
              <SortableHeader scope="col" className={styles.n} numeric {...table.header('flips')}>
                Flip-flops
              </SortableHeader>
              <SortableHeader scope="col" className={styles.n} numeric {...table.header('last10')}>
                <span className={styles.sr}>Last 10 commits</span>
              </SortableHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.project.slug}/${r.name}`}>
                <th scope="row">
                  <ShotLink
                    workspace={data.workspace.slug}
                    project={r.project.slug}
                    name={r.name}
                  />
                  <p className={styles.reasonMeta}>{flakyReasonText(r.reason)}</p>
                </th>
                {showProject ? (
                  <td>
                    <ProjectChip project={r.project} />
                  </td>
                ) : null}
                <td className={styles.n}>{r.flipFlops}</td>
                <td className={styles.n}>
                  <Strip last10={r.last10} kind="flaky" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  )
}

export function OldestWaitingCard({ data }: { data: Insights.Report }) {
  const table = useSortedTable('waiting', data.oldestWaiting, WAITING_COLUMNS)
  const rows = table.rows
  const showProject = data.project === null
  const now = Date.parse(data.range.to)
  return (
    <Card
      title="Oldest waiting builds"
      subtitle={`${formatCount(data.waitingNow)} waiting now`}
      empty={rows.length === 0 ? 'Nothing is waiting for review.' : undefined}
    >
      <TableWrap>
        <table className={styles.table}>
          <thead>
            <tr>
              <SortableHeader scope="col" {...table.header('build')}>
                Build
              </SortableHeader>
              {showProject ? (
                <SortableHeader scope="col" {...table.header('project')}>
                  Project
                </SortableHeader>
              ) : null}
              <SortableHeader scope="col" {...table.header('branch')}>
                Branch
              </SortableHeader>
              <SortableHeader scope="col" {...table.header('author')}>
                Author
              </SortableHeader>
              <SortableHeader scope="col" className={styles.n} numeric {...table.header('waiting')}>
                Waiting
              </SortableHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.buildId}>
                <th scope="row">
                  <span className={styles.person}>
                    <StatusIcon status="needs-review" size={14} />
                    <BuildLink
                      workspace={data.workspace.slug}
                      project={r.project.slug}
                      number={r.number}
                    />
                  </span>
                </th>
                {showProject ? (
                  <td>
                    <ProjectChip project={r.project} />
                  </td>
                ) : null}
                <td>
                  <span className={styles.branch} title={r.branch ?? undefined}>
                    {r.branch ?? '–'}
                  </span>
                </td>
                <td className={styles.nowrap}>
                  {r.author === null ? (
                    '–'
                  ) : (
                    <span className={styles.person}>
                      <Avatar type="user" id={r.author} name={r.author} image={null} size={20} />
                      {r.author}
                    </span>
                  )}
                </td>
                <td className={styles.n} data-over={r.overTarget ? '' : undefined}>
                  {formatWait(now - Date.parse(r.readyAt))}
                  {r.overTarget ? ' · over target' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  )
}

export function MostRejectedCard({ data, days }: { data: Insights.Report; days: number }) {
  const table = useSortedTable('rejected', data.mostRejected, REJECTED_COLUMNS)
  const rows = table.rows
  const showProject = data.project === null
  return (
    <Card
      title="Rejected most often"
      subtitle={`screenshots, ${rangeLabel(days)}`}
      empty={rows.length === 0 ? 'No screenshots were rejected.' : undefined}
    >
      <TableWrap>
        <table className={styles.table}>
          <thead>
            <tr>
              <SortableHeader scope="col" {...table.header('screenshot')}>
                Screenshot
              </SortableHeader>
              {showProject ? (
                <SortableHeader scope="col" {...table.header('project')}>
                  Project
                </SortableHeader>
              ) : null}
              <SortableHeader
                scope="col"
                className={styles.n}
                numeric
                {...table.header('rejected')}
              >
                Rejected
              </SortableHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.project.slug}/${r.name}`}>
                <th scope="row">
                  <ShotLink
                    workspace={data.workspace.slug}
                    project={r.project.slug}
                    name={r.name}
                  />
                </th>
                {showProject ? (
                  <td>
                    <ProjectChip project={r.project} />
                  </td>
                ) : null}
                <td className={styles.n}>
                  <span className={styles.person}>
                    <StatusIcon status="rejected" size={14} decorative />
                    {rejectionsLabel(r.rejections)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  )
}

import type { Insights } from '@circi/api'
import type { ReactNode } from 'react'

import { formatCount, formatHours } from './api.ts'
import { Card, Legend, Pill } from './Card.tsx'
import {
  type Axis,
  backlogLine,
  type Bucket,
  decisionLines,
  type Dot,
  failedBars,
  failedDelta,
  flakyDelta,
  flakyLine,
  flakySummary,
  labelIndexes,
  linePath,
  outcomeSentence,
  outcomeStacks,
  processingLines,
  reviewBars,
  reviewSummary,
  tickLabel,
} from './chart.ts'

import styles from './Insights.module.css'

/** The plot: gridlines with their labels in a 32px gutter, the marks, and a tooltip per slot. */
function Plot(props: {
  axis: Axis
  label: string
  /** One per slot (bar or point): the x label and the tooltip. */
  slots: { label: string; tip: string }[]
  /** Show every `n`th x label at most this many (3-up cards are narrower). */
  maxLabels?: number
  /** Right-align the last label, so a wide one stays inside the card (daily axes). */
  edgeLast?: boolean
  children: ReactNode
}) {
  const keep = labelIndexes(props.slots.length, props.maxLabels ?? 7)
  return (
    <div className={styles.plotWrap}>
      <div className={styles.plot} role="img" aria-label={props.label}>
        <div className={styles.area}>
          {props.axis.ticks.map((t) => (
            <div
              key={t}
              className={styles.gridline}
              style={{ bottom: `${(t / props.axis.top) * 100}%` }}
            >
              <span className={styles.tick}>{tickLabel(t)}</span>
            </div>
          ))}
          {props.children}
          <div className={styles.slots}>
            {props.slots.map((s) => (
              <span key={s.label} className={styles.slot} title={s.tip} />
            ))}
          </div>
        </div>
      </div>
      <div className={styles.xlabels}>
        {props.slots.map((s, i) => (
          <span
            key={s.label}
            data-edge={props.edgeLast && i === props.slots.length - 1 ? '' : undefined}
          >
            {keep.has(i) ? s.label : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The path of a line series across the plot, with a ring-edged dot on each value. */
function Line(props: { points: readonly Dot[]; series: string; dash?: boolean; area?: boolean }) {
  return (
    <>
      <svg className={styles.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {props.area ? (
          <path
            className={styles.areaFill}
            data-series={props.series}
            d={linePath(props.points, true)}
          />
        ) : null}
        <path
          className={styles.line}
          data-series={props.series}
          data-dash={props.dash}
          d={linePath(props.points)}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {props.points.map((p) =>
        p.y === null ? null : (
          <i
            key={p.label}
            className={styles.dot}
            data-series={props.series}
            style={{ left: `${p.x}%`, bottom: `${p.y}%` }}
          />
        ),
      )}
    </>
  )
}

/** "4h" or "1.5h": the target as the chart names it, no trailing ".0". */
const targetHours = (h: number | null) =>
  h === null ? '' : h < 1 ? formatHours(h) : `${Number(h.toFixed(1))}h`

const minutes = (m: number | null) => (m === null ? '–' : `${Number(m.toFixed(1))} min`)
const plural = (n: number, one: string, many = `${one}s`) =>
  `${formatCount(n)} ${n === 1 ? one : many}`
const range = (bucket: Bucket) => (bucket === 'day' ? 'Day' : 'Week')

export function ReviewCard({ data }: { data: Insights.Report }) {
  const { bucket, weeks } = data
  const { axis, bars, unit, goalPct } = (() => {
    const r = reviewBars(weeks, data.reviewTargetHours, bucket)
    return { axis: { top: r.top, ticks: r.ticks }, bars: r.bars, unit: r.unit, goalPct: r.goalPct }
  })()
  const empty = weeks.every((w) => w.medianReviewHours === null)
  return (
    <Card
      chart
      title="Median time to first review"
      subtitle={`${unit}, per ${bucket}`}
      empty={empty ? 'No reviews in this range.' : undefined}
      table={{
        columns: [range(bucket), 'Median', 'Reviews'],
        rows: weeks.map((w, i) => [
          bars[i]!.label,
          formatHours(w.medianReviewHours),
          formatCount(w.reviews),
        ]),
      }}
    >
      <Plot
        axis={axis}
        label={reviewSummary(weeks)}
        slots={bars.map((b, i) => ({
          label: b.label,
          tip:
            b.value === null
              ? `${b.name} · no reviews`
              : `${b.name} · ${formatHours(b.value)} median · ${plural(weeks[i]!.reviews, 'review')}`,
        }))}
      >
        <div className={styles.bars}>
          {bars.map((b) => (
            <div key={b.label} className={styles.col}>
              {b.value === null ? null : (
                <div className={styles.bar} style={{ height: `${b.height}%` }} />
              )}
            </div>
          ))}
        </div>
        {goalPct === null ? null : (
          <div className={styles.goal} style={{ bottom: `${goalPct}%` }}>
            <span
              className={styles.goalLabel}
            >{`target ${targetHours(data.reviewTargetHours)}`}</span>
          </div>
        )}
      </Plot>
    </Card>
  )
}

export function DecisionCard({ data }: { data: Insights.Report }) {
  const { bucket, weeks } = data
  const { top, ticks, median, p90 } = decisionLines(weeks, bucket)
  const empty = weeks.every((w) => w.decided === 0)
  return (
    <Card
      chart
      title="Time to decision"
      subtitle={`hours, per ${bucket}`}
      legend={
        <Legend
          items={[
            { label: 'Median', series: 'median' },
            { label: '90th percentile', series: 'p90', dash: true },
          ]}
        />
      }
      empty={empty ? 'No builds were decided in this range.' : undefined}
      table={{
        columns: [range(bucket), 'Median', '90th percentile', 'Builds'],
        rows: weeks.map((w, i) => [
          median[i]!.label,
          formatHours(w.medianDecisionHours),
          formatHours(w.p90DecisionHours),
          formatCount(w.decided),
        ]),
      }}
    >
      <Plot
        axis={{ top, ticks }}
        label={`Time to decision per ${bucket}: median and 90th percentile.`}
        slots={median.map((m, i) => ({
          label: m.label,
          tip:
            m.value === null
              ? `${m.name} · no builds decided`
              : `${m.name} · ${formatHours(m.value)} median · ${formatHours(p90[i]!.value)} 90th percentile · ${plural(weeks[i]!.decided, 'build')}`,
        }))}
      >
        <Line points={p90} series="p90" dash />
        <Line points={median} series="median" />
      </Plot>
    </Card>
  )
}

export function OutcomesCard({ data }: { data: Insights.Report }) {
  const { bucket, weeks } = data
  const { top, ticks, bars, empty } = outcomeStacks(weeks, bucket)
  return (
    <Card
      chart
      title={`Outcomes per ${bucket}`}
      subtitle="finished builds"
      legend={
        <Legend
          items={[
            { label: 'Approved', status: 'approved' },
            { label: 'Auto-approved', status: 'auto-approved' },
            { label: 'Rejected', status: 'rejected' },
            { label: 'Failed', status: 'failed' },
          ]}
        />
      }
      empty={empty ? 'No builds finished in this range.' : undefined}
      table={{
        columns: [range(bucket), 'Approved', 'Auto-approved', 'Rejected', 'Failed'],
        rows: weeks.map((w, i) => [
          bars[i]!.label,
          formatCount(w.outcomes.approved),
          formatCount(w.outcomes.autoApproved),
          formatCount(w.outcomes.rejected),
          formatCount(w.outcomes.failed),
        ]),
      }}
    >
      <Plot
        axis={{ top, ticks }}
        label={`Finished builds per ${bucket} by outcome: approved, auto-approved, rejected, failed.`}
        slots={bars.map((b) => ({ label: b.label, tip: `${b.name} · ${outcomeSentence(b)}` }))}
      >
        <div className={styles.bars}>
          {bars.map((b) => (
            <div key={b.label} className={styles.col}>
              <div className={styles.stack}>
                {b.segments.map((s) => (
                  <div
                    key={s.key}
                    className={styles.segment}
                    data-key={s.key}
                    style={{ height: `${s.height}%` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Plot>
    </Card>
  )
}

export function BacklogCard({ data }: { data: Insights.Report }) {
  const { top, ticks, points, empty } = backlogLine(data.backlog)
  const last = points.at(-1)
  return (
    <Card
      chart
      title="Waiting for review"
      subtitle="builds, end of each day"
      legend={<Legend items={[{ label: 'Needs review', status: 'needs-review' }]} />}
      empty={empty ? 'Nothing was waiting in this range.' : undefined}
      table={{
        columns: ['Day', 'Waiting'],
        rows: points.map((p) => [p.label, formatCount(p.value ?? 0)]),
      }}
    >
      <Plot
        axis={{ top, ticks }}
        label="Builds waiting for review at the end of each day."
        maxLabels={7}
        edgeLast
        slots={points.map((p) => ({
          label: p.label,
          tip: `${p.label} · ${plural(p.value ?? 0, 'build')} waiting`,
        }))}
      >
        <Line points={points} series="review" area />
        {last && last.y !== null ? (
          <span className={styles.endLabel} style={{ bottom: `calc(${last.y}% + 8px)` }}>
            {last.value} now
          </span>
        ) : null}
      </Plot>
    </Card>
  )
}

export function FlakyCard({ data }: { data: Insights.Report }) {
  const { bucket, weeks } = data
  const { top, ticks, points } = flakyLine(weeks, bucket)
  const move = flakyDelta(weeks)
  return (
    <Card
      chart
      title="Flaky screenshots"
      subtitle={`end of ${bucket}`}
      footerSlot
      footer={
        <>
          {move ? <Pill {...move} /> : null}
          <span className={styles.note}>
            Flaky means the image came back to an earlier version, or differed between runs of one
            commit.
          </span>
        </>
      }
      table={{
        columns: [range(bucket), 'Flaky screenshots'],
        rows: points.map((p) => [p.label, formatCount(p.value ?? 0)]),
      }}
    >
      <Plot
        axis={{ top, ticks }}
        label={flakySummary(weeks)}
        maxLabels={4}
        slots={points.map((p) => ({
          label: p.label,
          tip: `${p.name} · ${plural(p.value ?? 0, 'flaky screenshot')}`,
        }))}
      >
        <Line points={points} series="flaky" />
      </Plot>
    </Card>
  )
}

export function FailedCard({ data, days }: { data: Insights.Report; days: number }) {
  const { bucket, weeks } = data
  const { top, ticks, bars } = failedBars(weeks, bucket)
  const s = data.summary
  const move = failedDelta(s.failedBuilds, data.previous.failedBuilds)
  return (
    <Card
      chart
      title={`Failed builds per ${bucket}`}
      subtitle="builds"
      footerSlot
      footer={
        <>
          <Pill {...move} />
          <span
            className={styles.note}
          >{`${plural(s.failedBuilds, 'failed build')} in ${days} days.`}</span>
        </>
      }
      empty={s.failedBuilds === 0 ? 'No builds failed in this range.' : undefined}
      table={{
        columns: [range(bucket), 'Failed builds'],
        rows: bars.map((b) => [b.label, formatCount(b.value ?? 0)]),
      }}
    >
      <Plot
        axis={{ top, ticks }}
        label={`Failed builds per ${bucket}.`}
        maxLabels={4}
        slots={bars.map((b) => ({
          label: b.label,
          tip: `${b.name} · ${plural(b.value ?? 0, 'failed build')}`,
        }))}
      >
        <div className={styles.bars}>
          {bars.map((b) => (
            <div key={b.label} className={styles.col}>
              {b.value ? (
                <div className={styles.bar} data-fill="failed" style={{ height: `${b.height}%` }} />
              ) : null}
            </div>
          ))}
        </div>
      </Plot>
    </Card>
  )
}

export function ProcessingCard({ data }: { data: Insights.Report }) {
  const { bucket, weeks } = data
  const { top, ticks, median, p90 } = processingLines(weeks, bucket)
  const latest = weeks.findLast((w) => w.medianProcessingMinutes !== null)
  return (
    <Card
      chart
      title="Processing time"
      subtitle={`minutes, per ${bucket}`}
      legend={
        <Legend
          items={[
            { label: 'Median', series: 'processing' },
            { label: '90th percentile', series: 'processing', dash: true },
          ]}
        />
      }
      footerSlot
      footer={
        latest ? (
          <span className={styles.note}>
            {`Latest ${bucket}: ${minutes(latest.medianProcessingMinutes)} median, ${minutes(latest.p90ProcessingMinutes)} 90th percentile.`}
          </span>
        ) : null
      }
      empty={latest ? undefined : 'No builds finished in this range.'}
      table={{
        columns: [range(bucket), 'Median', '90th percentile'],
        rows: weeks.map((w, i) => [
          median[i]!.label,
          minutes(w.medianProcessingMinutes),
          minutes(w.p90ProcessingMinutes),
        ]),
      }}
    >
      <Plot
        axis={{ top, ticks }}
        label={`Processing time per ${bucket}: median and 90th percentile, in minutes.`}
        maxLabels={4}
        slots={median.map((m, i) => ({
          label: m.label,
          tip:
            m.value === null
              ? `${m.name} · no builds finished`
              : `${m.name} · ${minutes(m.value)} median · ${minutes(p90[i]!.value)} 90th percentile`,
        }))}
      >
        <Line points={p90} series="processing" dash />
        <Line points={median} series="processing" />
      </Plot>
    </Card>
  )
}

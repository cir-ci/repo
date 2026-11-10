import type { Insights } from '@circi/api'
import { useId } from 'react'

import { formatHours } from './api.ts'
import {
  flakyLine,
  flakySummary,
  labelIndexes,
  PLOT,
  reviewBars,
  reviewSummary,
  tickLabel,
  yAt,
} from './chart.ts'

import styles from './Insights.module.css'

const base = PLOT.height - PLOT.bottom

function Frame(props: {
  title: string
  summary: string
  ticks: number[]
  top: number
  labels: { x: number; text: string }[]
  yLabel: string
  children: React.ReactNode
  table: React.ReactNode
}) {
  const id = useId()
  return (
    <>
      <svg
        viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
        className={styles.chart}
        role="img"
        aria-labelledby={id}
      >
        <title id={id}>{`${props.title}. ${props.summary}`}</title>
        {[...props.ticks, 0].map((t) => (
          <g key={t}>
            <line
              className={styles.gridline}
              x1={PLOT.left}
              x2={PLOT.width - PLOT.right}
              y1={yAt(PLOT, t, props.top)}
              y2={yAt(PLOT, t, props.top)}
            />
            <text
              className={styles.tick}
              x={PLOT.left - 6}
              y={yAt(PLOT, t, props.top) + 4}
              textAnchor="end"
            >
              {tickLabel(t)}
            </text>
          </g>
        ))}
        {props.children}
        {props.labels.map((l) => (
          <text key={l.x} className={styles.tick} x={l.x} y={PLOT.height - 6} textAnchor="middle">
            {l.text}
          </text>
        ))}
      </svg>
      <span className={styles.axisTitle}>{props.yLabel}</span>
      {props.table}
    </>
  )
}

const WeekTable = (props: {
  caption: string
  column: string
  rows: { week: string; value: string }[]
}) => (
  <table className={styles.sr}>
    <caption>{props.caption}</caption>
    <thead>
      <tr>
        <th scope="col">Week starting</th>
        <th scope="col">{props.column}</th>
      </tr>
    </thead>
    <tbody>
      {props.rows.map((r) => (
        <tr key={r.week}>
          <th scope="row">{r.week}</th>
          <td>{r.value}</td>
        </tr>
      ))}
    </tbody>
  </table>
)

export function ReviewChart({ weeks }: { weeks: readonly Insights.Week[] }) {
  const { top, ticks, bars, unit } = reviewBars(weeks)
  const keep = labelIndexes(bars.length)
  const slot = (PLOT.width - PLOT.left - PLOT.right) / Math.max(1, bars.length)
  const width = Math.min(28, slot * 0.6)
  return (
    <Frame
      title="Median time to review, per week"
      summary={reviewSummary(weeks)}
      ticks={ticks}
      top={top}
      yLabel={unit === 'hours' ? 'Hours' : 'Minutes'}
      labels={bars.flatMap((b, i) => (keep.has(i) ? [{ x: b.x, text: b.label }] : []))}
      table={
        <WeekTable
          caption="Median time to review, per week"
          column="Median hours"
          rows={bars.map((b, i) => ({
            week: b.label,
            value: `${formatHours(b.value)} (${weeks[i]!.reviews} reviews)`,
          }))}
        />
      }
    >
      {bars.map((b) =>
        b.value === null ? null : (
          <rect
            key={b.x}
            className={styles.bar}
            x={b.x - width / 2}
            y={b.y}
            width={width}
            height={b.height}
            rx={3}
          />
        ),
      )}
      <line
        className={styles.axis}
        x1={PLOT.left}
        x2={PLOT.width - PLOT.right}
        y1={base}
        y2={base}
      />
    </Frame>
  )
}

export function FlakyChart({ weeks }: { weeks: readonly Insights.Week[] }) {
  const { top, ticks, points, path } = flakyLine(weeks)
  const keep = labelIndexes(points.length)
  return (
    <Frame
      title="Flaky screenshots, open at the end of each week"
      summary={flakySummary(weeks)}
      ticks={ticks}
      top={top}
      yLabel="Flaky screenshots"
      labels={points.flatMap((p, i) => (keep.has(i) ? [{ x: p.x, text: p.label }] : []))}
      table={
        <WeekTable
          caption="Flaky screenshots, open at the end of each week"
          column="Flaky screenshots"
          rows={points.map((p) => ({ week: p.label, value: String(p.value) }))}
        />
      }
    >
      {points.length > 1 ? <path className={styles.line} d={path} /> : null}
      {points.map((p) => (
        <circle key={p.x} className={styles.dot} cx={p.x} cy={p.y} r={3.5} />
      ))}
      <line
        className={styles.axis}
        x1={PLOT.left}
        x2={PLOT.width - PLOT.right}
        y1={base}
        y2={base}
      />
    </Frame>
  )
}

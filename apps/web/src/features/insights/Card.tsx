import type { Insights } from '@circi/api'
import { Avatar, SortableHeader, StatusIcon, type Status, Toggle } from '@circi/ui'
import { type ReactNode, useId, useState } from 'react'

import { isTeamColor } from '#features/teams/appearance.ts'
import { type Accessors, cellValue } from '#lib/sort.ts'

import { useSortedTable } from './sort.tsx'

import styles from './Insights.module.css'

export interface TableView {
  columns: string[]
  rows: string[][]
}

/** A table that scrolls sideways inside its card instead of being cut off. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className={styles.tw}>{children}</div>
}

/** The "View as table" version of a chart: the same numbers, one row per bar or point. */
export function DataTable({ caption, view }: { caption: string; view: TableView }) {
  // The cells are text as shown ("1,234", "3.4h", "45%"); a column sorts by the figure they hold.
  const accessors: Accessors<string[]> = Object.fromEntries(
    view.columns.map((_, i) => [`c${i}`, (row: string[]) => cellValue(row[i] ?? '')]),
  )
  const table = useSortedTable(`chart-${tableName(caption)}`, view.rows, accessors)
  return (
    <TableWrap>
      <table className={styles.table}>
        <caption className={styles.sr}>{caption}</caption>
        <thead>
          <tr>
            {view.columns.map((c, i) => (
              <SortableHeader
                key={c}
                scope="col"
                numeric={i !== 0}
                className={i === 0 ? undefined : styles.n}
                {...table.header(`c${i}`)}
              >
                {c}
              </SortableHeader>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={cell} scope="row">
                    {cell}
                  </th>
                ) : (
                  // oxlint-disable-next-line react/no-array-index-key -- cells are positional
                  <td key={i} className={styles.n}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  )
}

/** A card's title as the name of its table in the URL: `Median time to first review` becomes `median-time-to-first-review`. */
const tableName = (caption: string) => caption.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')

/**
 * One card: a 24px header (title, one-line subtitle, "View as table"), then the body. Chart
 * cards also reserve a legend slot and, in the three-up row, a footer slot, so plots in a row
 * start and end at the same place.
 */
export function Card(props: Card.Props) {
  const id = useId()
  const [asTable, setAsTable] = useState(false)
  const showTable = asTable && props.table !== undefined && props.empty === undefined
  return (
    <section className={styles.card} aria-labelledby={id} data-wide={props.wide ? '' : undefined}>
      <div className={styles.head}>
        <h3 id={id} className={styles.title}>
          {props.title}
        </h3>
        {props.subtitle === undefined ? null : (
          <span className={styles.sub} title={props.subtitle}>
            {props.subtitle}
          </span>
        )}
        <span className={styles.spacer} />
        {props.table !== undefined && props.empty === undefined ? (
          <Toggle pressed={asTable} onPressedChange={setAsTable}>
            View as table
          </Toggle>
        ) : null}
      </div>
      {props.chart ? (
        <div className={styles.legendSlot}>{props.empty === undefined ? props.legend : null}</div>
      ) : null}
      {props.empty === undefined ? (
        showTable && props.table ? (
          <DataTable caption={props.title} view={props.table} />
        ) : (
          props.children
        )
      ) : (
        <p className={styles.empty}>{props.empty}</p>
      )}
      {props.footerSlot ? <div className={styles.footerSlot}>{props.footer}</div> : null}
    </section>
  )
}

export namespace Card {
  export interface Props {
    title: string
    subtitle?: string
    children?: ReactNode
    /** Marks a chart card: it gets the legend slot even with no legend. */
    chart?: boolean
    legend?: ReactNode
    /** The table version; without it there is no "View as table" button. */
    table?: TableView
    /** Shown in place of the body (and the legend and button) when there is no data. */
    empty?: string
    footerSlot?: boolean
    footer?: ReactNode
    /** Spans the full width of the grid. */
    wide?: boolean
  }
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className={styles.legend}>
      {items.map((item) => (
        <li key={item.label}>
          {item.status ? (
            <StatusIcon status={item.status} size={12} decorative />
          ) : (
            <i className={styles.swatch} data-series={item.series} data-dash={item.dash} />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  )
}

export interface LegendItem {
  label: string
  /** A status glyph, for series that are statuses. */
  status?: Status
  /** A line swatch for line series. */
  series?: 'median' | 'p90' | 'processing' | 'flaky' | 'review'
  dash?: boolean
}

const GLYPHS = new Map([
  ['▲', 'up'],
  ['▼', 'down'],
  ['●', 'flat'],
])

/**
 * A change chip. The deltas lead with a glyph ("▲ 9 vs before"); it is drawn as a shape rather
 * than a character, since each font sets those characters at its own height and none centres on
 * the text.
 */
export function Pill(props: { tone: 'good' | 'bad' | 'neutral'; text: string; label: string }) {
  const glyph = GLYPHS.get(props.text.charAt(0))
  const text = glyph ? props.text.slice(1).trimStart() : props.text
  return (
    <span className={styles.pill} data-tone={props.tone} aria-label={props.label}>
      {glyph ? <i className={styles.glyph} data-glyph={glyph} aria-hidden="true" /> : null}
      {text}
    </span>
  )
}

/** The team's avatar, as everywhere else in the app. */
export function TeamChip({ team }: { team: Insights.TeamRef }) {
  return isTeamColor(team.colour) ? (
    <Avatar
      type="team"
      slug={team.slug}
      name={team.name}
      color={team.colour}
      icon={team.icon}
      size={20}
    />
  ) : null
}

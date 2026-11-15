import { Avatar, Radio, RadioGroup, Text, type ProjectColor } from '@circi/ui'
import { useInfiniteQuery } from '@tanstack/react-query'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { filterIcons, ICON_PAGE, iconLabel, iconColumns, ICON_ROW_HEIGHT } from './appearance.ts'

import styles from './IconPicker.module.css'

/** The value of the "No icon" cell (a radio's value is a string). */
const NO_ICON = '#none'

/**
 * The project icon grid: every Lucide icon matching the search, in a scrolling box. The matches
 * come a page at a time from an infinite query (the next page loads as the end scrolls into
 * view), and only the rows in view are drawn, so 2,000 icons cost what a screenful does.
 * "No icon" is always the first cell.
 *
 * One radio group: one Tab stop (the chosen icon's), the arrow keys move and choose. Left and
 * Right step through the cells, Up and Down by a row (scrolling it into view first: only the rows
 * in view exist). The chosen icon's row stays drawn when scrolled out of view, so the group always
 * has its Tab stop.
 */
export function IconPicker({ project, name, color, icon, query, onPick }: IconPicker.Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const matches = useMemo(() => filterIcons(query), [query])
  const pages = useInfiniteQuery({
    queryKey: ['project-icons', query],
    queryFn: ({ pageParam }) => matches.slice(pageParam, pageParam + ICON_PAGE),
    initialPageParam: 0,
    getNextPageParam: (_last, all) => {
      const loaded = all.reduce((n, page) => n + page.length, 0)
      return loaded < matches.length ? loaded : undefined
    },
    staleTime: Infinity,
  })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages
  // `null` is the "No icon" cell.
  const cells: (string | null)[] = useMemo(
    () => [null, ...(pages.data?.pages.flat() ?? [])],
    [pages.data],
  )
  const columns = iconColumns(width)
  const rows = Math.ceil(cells.length / columns)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return undefined
    setWidth(el.clientWidth)
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // A new search starts at the top.
  useEffect(() => {
    scroller.current?.scrollTo?.({ top: 0 })
  }, [query])

  const chosenRow = Math.floor(Math.max(cells.indexOf(icon), 0) / columns)

  // oxlint-disable-next-line react/incompatible-library -- the app doesn't use React Compiler; the virtualizer re-renders this component itself.
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scroller.current,
    estimateSize: () => ICON_ROW_HEIGHT,
    overscan: 4,
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), chosenRow])]
        .filter((row) => row < rows)
        .toSorted((a, b) => a - b),
  })
  const items = virtualizer.getVirtualItems()
  const lastRow = items.at(-1)?.index ?? 0

  // The end is in view: load the next page.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && lastRow >= rows - 2) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, lastRow, rows, fetchNextPage])

  // Up and Down: the cell a row away, its row scrolled in, then it takes focus (and, as with the arrow keys, is chosen).
  const moveByRow = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    const cell =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-cell]') : null
    const at = Number(cell?.dataset['cell'])
    if (!cell || !Number.isInteger(at)) return
    event.preventDefault()
    event.stopPropagation()
    const next = at + (event.key === 'ArrowUp' ? -columns : columns)
    if (next < 0 || next >= cells.length) return
    virtualizer.scrollToIndex(Math.floor(next / columns))
    const reach = (tries: number) => {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-cell="${next}"]`)
      if (el) {
        el.focus()
      } else if (tries > 0) requestAnimationFrame(() => reach(tries - 1))
    }
    requestAnimationFrame(() => reach(10))
  }

  return (
    <>
      <div ref={scroller} className={styles.scroller}>
        <RadioGroup
          label="Icon"
          value={icon ?? NO_ICON}
          onValueChange={(next) => onPick(next === NO_ICON ? null : next)}
          className={styles.canvas}
          style={{ height: virtualizer.getTotalSize() }}
          onKeyDownCapture={moveByRow}
        >
          {items.map((row) => (
            <div
              key={row.key}
              className={styles.row}
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {cells.slice(row.index * columns, (row.index + 1) * columns).map((cell, offset) => {
                const label = cell === null ? 'No icon' : iconLabel(cell)
                return (
                  <Radio
                    key={cell ?? 'none'}
                    value={cell ?? NO_ICON}
                    className={styles.cell}
                    data-cell={row.index * columns + offset}
                    aria-label={label}
                    title={label}
                  >
                    <Avatar
                      type="project"
                      aria-hidden
                      slug={project}
                      name={name}
                      color={color}
                      icon={cell}
                      size={20}
                    />
                  </Radio>
                )
              })}
            </div>
          ))}
        </RadioGroup>
      </div>
      {matches.length === 0 ? (
        <Text variant="small" tone="tertiary">
          No icon matches “{query}”.
        </Text>
      ) : null}
    </>
  )
}

export namespace IconPicker {
  export interface Props {
    /** The project's slug and name: the cells draw its marble. */
    project: string
    name: string
    color: ProjectColor
    /** The icon it has now; null for none. */
    icon: string | null
    /** The search text above the grid. */
    query: string
    onPick: (icon: string | null) => void
  }
}

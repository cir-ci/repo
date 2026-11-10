import { Avatar, Button, Text, type TeamColor } from '@circi/ui'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { filterIcons, ICON_PAGE, iconLabel, iconColumns, ICON_ROW_HEIGHT } from './appearance.ts'

import styles from './IconPicker.module.css'

/**
 * The team icon grid: every Lucide icon matching the search, in a scrolling box. The matches
 * come a page at a time from an infinite query (the next page loads as the end scrolls into
 * view), and only the rows in view are drawn, so 2,000 icons cost what a screenful does.
 * "No icon" is always the first cell.
 */
export function IconPicker({ team, name, color, icon, query, onPick }: IconPicker.Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const matches = useMemo(() => filterIcons(query), [query])
  const pages = useInfiniteQuery({
    queryKey: ['team-icons', query],
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

  // oxlint-disable-next-line react/incompatible-library -- the app doesn't use React Compiler; the virtualizer re-renders this component itself.
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scroller.current,
    estimateSize: () => ICON_ROW_HEIGHT,
    overscan: 4,
  })
  const items = virtualizer.getVirtualItems()
  const lastRow = items.at(-1)?.index ?? 0

  // The end is in view: load the next page.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && lastRow >= rows - 2) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, lastRow, rows, fetchNextPage])

  return (
    <>
      <div ref={scroller} className={styles.scroller}>
        <div
          role="group"
          aria-label="Icon"
          className={styles.canvas}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {items.map((row) => (
            <div
              key={row.key}
              className={styles.row}
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {cells.slice(row.index * columns, (row.index + 1) * columns).map((cell) => {
                const label = cell === null ? 'No icon' : iconLabel(cell)
                return (
                  <Button
                    key={cell ?? 'none'}
                    variant="toggle"
                    size="md"
                    className={styles.cell}
                    pressed={icon === cell}
                    onPressedChange={() => onPick(cell)}
                    aria-label={label}
                    title={label}
                  >
                    <Avatar
                      type="team"
                      aria-hidden
                      slug={team}
                      name={name}
                      color={color}
                      icon={cell}
                      size={20}
                    />
                  </Button>
                )
              })}
            </div>
          ))}
        </div>
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
    /** The team's slug and name: the cells draw its marble. */
    team: string
    name: string
    color: TeamColor
    /** The icon it has now; null for none. */
    icon: string | null
    /** The search text above the grid. */
    query: string
    onPick: (icon: string | null) => void
  }
}

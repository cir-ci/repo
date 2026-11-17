import type { ReactNode } from 'react'

import { Button } from './Button.tsx'
import { cx } from './cx.ts'
import { InboxIcon, SearchIcon } from './icons.ts'
import { StatusIcon } from './StatusIcon.tsx'

import styles from './EmptyState.module.css'

/**
 * The one look of a list with nothing in it (the "Empty states" boards): a Lucide icon at 32px
 * (stroke 1.5, tertiary), a 15/600 title, at most one sentence of body (360px wide at most) and at
 * most one action, stacked and centred. `size="page"` fills the content area under the page
 * header; `section` sits inside a card or tab panel. `tone="success"` is for "nothing to do"
 * (the approved glyph unless an icon is given), `failed` for an error (the page's own words and
 * a retry button as `action`). A line inside a field, dialog or popover is plain `Text`, and a
 * pane that has nothing selected is a `PanePlaceholder`.
 */
export function EmptyState({
  icon,
  title,
  headingLevel = 2,
  tone = 'neutral',
  size = 'page',
  action,
  className,
  children,
}: EmptyState.Props) {
  const Heading = `h${headingLevel}` as const
  const glyph =
    icon ??
    (tone === 'success' ? <StatusIcon status="approved" size={32} decorative /> : <InboxIcon />)
  return (
    <div data-tone={tone} data-size={size} className={cx(styles.root, className)}>
      <span className={styles.icon} aria-hidden="true">
        {glyph}
      </span>
      <Heading className={styles.title}>{title}</Heading>
      {/* A div, not a p: a description may hold its own paragraphs or a Collapsible. */}
      {children ? (
        <div data-part="description" className={styles.description}>
          {children}
        </div>
      ) : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}

export namespace EmptyState {
  export interface Props {
    /** A Lucide icon (drawn at 32px, stroke 1.5, whatever size it is given); an inbox by default. */
    icon?: ReactNode
    title: ReactNode
    /** Which heading level the title is, to fit the page's outline. */
    headingLevel?: 1 | 2 | 3
    /** `success` for "nothing to do", `failed` for an error. */
    tone?: 'neutral' | 'success' | 'failed'
    /** `page` fills the content area (48/24 padding); `section` sits inside a card (32/24). */
    size?: 'page' | 'section'
    /** The one optional action: a primary button to create, a secondary one to clear, or a `CommandBlock`. */
    action?: ReactNode
    className?: string
    /** One sentence of `text.secondary`. */
    children?: ReactNode
  }
}

/** The longest a typed query gets in a title before it is cut with an ellipsis. */
const QUERY_MAX = 24

function shown(query: string) {
  const text = query.trim()
  return text.length > QUERY_MAX ? `${text.slice(0, QUERY_MAX).trimEnd()}…` : text
}

/**
 * A search that found nothing: "No project matches “x”" with a Clear search button that empties the
 * field. `noun` is singular and lower case.
 */
export function NoResults({ noun, query, onClear, size = 'page', className }: NoResults.Props) {
  return (
    <EmptyState
      icon={<SearchIcon />}
      size={size}
      className={className}
      title={`No ${noun} matches “${shown(query)}”`}
      action={<Button onClick={onClear}>Clear search</Button>}
    />
  )
}

export namespace NoResults {
  export interface Props {
    /** Singular, lower case: "baseline" ("No baseline matches “x”"). */
    noun: string
    query: string
    /** Empties the search field. */
    onClear: () => void
    size?: EmptyState.Props['size']
    className?: string
  }
}

/** Filters or a saved view that match nothing: "No builds match", "Nothing in web-app fits these filters.", Clear filters. */
export function NoFilterResults({
  plural,
  scope,
  onClear,
  size = 'page',
  className,
}: NoFilterResults.Props) {
  return (
    <EmptyState
      icon={<SearchIcon />}
      size={size}
      className={className}
      title={`No ${plural} match`}
      action={<Button onClick={onClear}>Clear filters</Button>}
    >
      {`Nothing in ${scope} fits these filters.`}
    </EmptyState>
  )
}

export namespace NoFilterResults {
  export interface Props {
    /** Plural, lower case: "builds". */
    plural: string
    /** Where it looked: a project or workspace name. */
    scope: string
    /** Resets every filter. */
    onClear: () => void
    size?: EmptyState.Props['size']
    className?: string
  }
}

/**
 * What a detail pane shows while nothing in the list beside it is selected: a 32px icon and one
 * line, no title. Show it only while the list has items; an empty list leaves the pane blank.
 */
export function PanePlaceholder({
  icon,
  detail,
  hint,
  className,
  children,
}: PanePlaceholder.Props) {
  return (
    <div className={cx(styles.pane, className)}>
      <span className={styles.icon} aria-hidden="true">
        {icon ?? <InboxIcon />}
      </span>
      <p className={styles.paneLine}>{children}</p>
      {detail ? <p className={styles.paneLine}>{detail}</p> : null}
      {hint ? <p className={styles.paneHint}>{hint}</p> : null}
    </div>
  )
}

export namespace PanePlaceholder {
  export interface Props {
    icon?: ReactNode
    /** A second line under it, when the pane has more to say ("Pick a build from the list to read it here."). */
    detail?: ReactNode
    /** A quiet keyboard hint under the lines. */
    hint?: ReactNode
    className?: string
    /** The one line: "Select a notification". */
    children: ReactNode
  }
}

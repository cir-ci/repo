import {
  Autocomplete,
  Button,
  CloseIcon,
  IconButton,
  Popover,
  SegmentedControl,
  Switch,
  Text,
  TextField,
} from '@circi/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { type FormEvent, useDeferredValue, useState } from 'react'

import { workspaceQuery } from '#features/members/api.ts'
import { branchesQuery, suggestionsQuery } from '#features/teams/api/index.ts'

import {
  type BuildFilters,
  chipName,
  dayOf,
  FILTER_FIELDS,
  PENDING_NAME,
  type FilterField,
  fieldValue,
  hasFilters,
  STATE_OPTIONS,
  activeState,
  withDates,
  withBranch,
  withState,
  withText,
  without,
} from './builds-filters.ts'
import {
  type DisplayOptions,
  GROUP_LABEL,
  GROUPS,
  ORDER_LABEL,
  ORDERS,
  PROPERTIES,
  PROPERTY_LABEL,
} from './display-options.ts'

import styles from './BuildFilterBar.module.css'

/** A chip for each filter (a dashed button that fills in once set), the display options and Save view. */
export function BuildFilterBar({
  workspace,
  team,
  filters,
  onFiltersChange,
  display,
  onDisplayChange,
  open,
  onOpenChange,
  onSaveView,
  savedAs,
}: BuildFilterBar.Props) {
  // People's names for the author and reviewer chips, which hold user ids once a suggestion is picked.
  const members = useQuery({ ...workspaceQuery(workspace), staleTime: 60_000 })
  // Until the member list is known a person's chip says "…", never the raw ID from the address.
  const labels = members.isPending
    ? undefined
    : new Map((members.data?.members ?? []).map((m) => [m.userId, m.user.name]))
  const set = (next: BuildFilters, close = true) => {
    onFiltersChange(next)
    if (close) onOpenChange(undefined)
  }
  return (
    <div className={styles.bar} role="group" aria-label="Filters">
      {FILTER_FIELDS.map(({ field, label }) => {
        const active = fieldValue(field, filters) !== undefined
        return (
          <span key={field} className={styles.chip} data-active={active ? '' : undefined}>
            <Popover
              label={`Filter by ${label.toLowerCase()}`}
              open={open === field}
              onOpenChange={(next) => onOpenChange(next ? field : undefined)}
              trigger={
                <Button
                  variant="filter"
                  size="sm"
                  pressed={active}
                  aria-keyshortcuts={field === 'status' ? 'f' : undefined}
                >
                  {chipName(field, filters, labels)}
                </Button>
              }
            >
              <FieldEditor
                workspace={workspace}
                team={team}
                field={field}
                filters={filters}
                labels={labels}
                onChange={set}
              />
            </Popover>
            {active ? (
              <IconButton
                className={styles.clear}
                label={`Clear ${label.toLowerCase()}`}
                title={`Clear ${label.toLowerCase()}`}
                onClick={() => set(without(filters, field))}
              >
                <CloseIcon size={12} />
              </IconButton>
            ) : null}
          </span>
        )
      })}
      {hasFilters(filters) ? (
        <>
          <Button size="sm" variant="ghost" onClick={() => set({})}>
            Clear filters
          </Button>
          {onSaveView && savedAs !== undefined ? (
            <Text variant="small" tone="secondary" role="status">
              Saved as {savedAs}
            </Text>
          ) : onSaveView ? (
            <Button size="sm" onClick={onSaveView}>
              Save view
            </Button>
          ) : null}
        </>
      ) : null}
      <span className={styles.spacer} />
      <Popover
        label="Display options"
        align="end"
        open={open === 'display'}
        onOpenChange={(next) => onOpenChange(next ? 'display' : undefined)}
        trigger={
          <Button size="sm" aria-keyshortcuts="shift+v">
            Display
          </Button>
        }
      >
        <DisplayEditor display={display} onChange={onDisplayChange} />
      </Popover>
    </div>
  )
}

export namespace BuildFilterBar {
  export interface Props {
    workspace: string
    /** The team whose branches the Branch picker offers; without one, the workspace's. */
    team?: string | undefined
    filters: BuildFilters
    onFiltersChange: (filters: BuildFilters) => void
    display: DisplayOptions
    onDisplayChange: (display: DisplayOptions) => void
    /** Which popover is open (the F and ⇧V shortcuts open them). */
    open: FilterField | 'display' | undefined
    onOpenChange: (open: FilterField | 'display' | undefined) => void
    /** Omit where saving is not offered (a saved view's own page). */
    onSaveView?: (() => void) | undefined
    /** The name of the saved view these filters already are: shown instead of Save view. */
    savedAs?: string | undefined
  }
}

function FieldEditor({
  workspace,
  team,
  field,
  filters,
  labels,
  onChange,
}: {
  workspace: string
  team: string | undefined
  field: FilterField
  filters: BuildFilters
  labels: ReadonlyMap<string, string> | undefined
  onChange: (filters: BuildFilters) => void
}) {
  if (field === 'status') {
    const current = activeState(filters)
    return (
      <SegmentedControl
        label="Status"
        wrap
        options={STATE_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
        value={current?.id}
        onChange={(id) => onChange(withState(filters, id))}
      />
    )
  }
  if (field === 'date') return <DateEditor filters={filters} onChange={onChange} />
  if (field === 'branch') {
    return <BranchEditor workspace={workspace} team={team} filters={filters} onChange={onChange} />
  }
  return (
    <TextEditor
      // Starts over once the names arrive, so a user ID never sits in the field.
      key={labels ? 'named' : 'loading'}
      workspace={workspace}
      field={field}
      filters={filters}
      labels={labels}
      onChange={onChange}
    />
  )
}

function TextEditor({
  workspace,
  field,
  filters,
  labels,
  onChange,
}: {
  workspace: string
  field: 'author' | 'reviewer' | 'name'
  filters: BuildFilters
  labels: ReadonlyMap<string, string> | undefined
  onChange: (filters: BuildFilters) => void
}) {
  // A person is filtered by user ID; the field shows (and edits) their name.
  const current = filters[field]
  const currentName = current === undefined ? undefined : fieldValue(field, filters, labels)
  const [text, setText] = useState(currentName === PENDING_NAME ? '' : (currentName ?? ''))
  const label = FILTER_FIELDS.find((f) => f.field === field)?.label ?? field
  const submit = (event: FormEvent) => {
    event.preventDefault()
    // Unchanged text is still the person already filtered by, not their name as free text.
    onChange(withText(filters, field, text === currentName && current ? current : text))
  }
  return (
    <form onSubmit={submit} className={styles.form}>
      <TextField label={label} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
      <Button type="submit" size="sm" variant="primary">
        Apply
      </Button>
      {field === 'author' || field === 'reviewer' ? (
        <Suggestions
          workspace={workspace}
          field={field}
          text={text}
          onPick={(value) => onChange(withText(filters, field, value))}
        />
      ) : null}
    </form>
  )
}

/**
 * The Branch chip's picker, like GitHub's branch select: the branches builds were made on, most
 * recent first, narrowed as you type (the server matches any part of the name, in any case),
 * with arrow keys and Enter. Picking one filters to exactly that branch; text that is not a
 * branch filters by branches that contain it.
 */
function BranchEditor({
  workspace,
  team,
  filters,
  onChange,
}: {
  workspace: string
  team: string | undefined
  filters: BuildFilters
  onChange: (filters: BuildFilters) => void
}) {
  const [text, setText] = useState(filters.branch ?? filters.branchContains ?? '')
  const typed = useDeferredValue(text.trim())
  const { data } = useQuery({
    ...branchesQuery(workspace, team, typed),
    placeholderData: keepPreviousData,
  })
  const names = (data?.branches ?? []).map((b) => b.name)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onChange(withBranch(filters, text, { known: names }))
      }}
      className={styles.form}
    >
      <Autocomplete
        label="Branch"
        value={text}
        autoFocus
        onValueChange={setText}
        items={names}
        onPick={(name) => onChange(withBranch(filters, name, { picked: true }))}
        listLabel="Branches"
        emptyText={
          data
            ? text.trim()
              ? `No branch matches “${text.trim()}”. Press Enter to filter by name.`
              : 'No branches yet.'
            : 'Loading branches'
        }
      />
      <Button type="submit" size="sm" variant="primary">
        Apply
      </Button>
    </form>
  )
}

/** Typeahead for the author and reviewer chips: the workspace's members, narrowed as you type. */
function Suggestions({
  workspace,
  field,
  text,
  onPick,
}: {
  workspace: string
  field: 'author' | 'reviewer'
  text: string
  onPick: (value: string) => void
}) {
  const typed = useDeferredValue(text.trim())
  const { data } = useQuery(suggestionsQuery(workspace, field, typed))
  const items = data?.suggestions ?? []
  if (items.length === 0) return null
  return (
    <ul aria-label="Suggestions" className={styles.suggestions}>
      {items.map((s) => (
        <li key={`${s.kind}:${s.value}`}>
          <Button size="sm" variant="ghost" onClick={() => onPick(s.value)}>
            {s.label}
          </Button>
        </li>
      ))}
    </ul>
  )
}

function DateEditor({
  filters,
  onChange,
}: {
  filters: BuildFilters
  onChange: (filters: BuildFilters) => void
}) {
  const [from, setFrom] = useState(dayOf(filters.from))
  const [to, setTo] = useState(dayOf(filters.to))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onChange(withDates(filters, from, to))
  }
  return (
    <form onSubmit={submit} className={styles.form}>
      <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      <Button type="submit" size="sm" variant="primary">
        Apply
      </Button>
    </form>
  )
}

function DisplayEditor({
  display,
  onChange,
}: {
  display: DisplayOptions
  onChange: (display: DisplayOptions) => void
}) {
  return (
    <>
      <Text variant="small" tone="secondary" aria-hidden="true">
        Group by
      </Text>
      <SegmentedControl
        label="Group by"
        wrap
        options={GROUPS.map((g) => ({ value: g, label: GROUP_LABEL[g] }))}
        value={display.groupBy}
        onChange={(next) => {
          const groupBy = GROUPS.find((g) => g === next)
          if (groupBy) onChange({ ...display, groupBy })
        }}
      />
      <Text variant="small" tone="secondary" aria-hidden="true">
        Order
      </Text>
      <SegmentedControl
        label="Order"
        wrap
        options={ORDERS.map((o) => ({ value: o, label: ORDER_LABEL[o] }))}
        value={display.order}
        onChange={(next) => {
          const order = ORDERS.find((o) => o === next)
          if (order) onChange({ ...display, order })
        }}
      />
      <Text variant="small" tone="secondary">
        Show
      </Text>
      {PROPERTIES.map((p) => (
        <Switch
          key={p}
          label={PROPERTY_LABEL[p]}
          checked={display.show[p]}
          onCheckedChange={(checked) =>
            onChange({ ...display, show: { ...display.show, [p]: checked } })
          }
        />
      ))}
    </>
  )
}

import { Button, Popover, Switch, Text, TextField } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useDeferredValue, useState } from 'react'

import { workspaceQuery } from '#features/members/api.ts'
import { suggestionsQuery } from '#features/teams/api/index.ts'

import {
  type BuildFilters,
  chipName,
  dayOf,
  FILTER_FIELDS,
  type FilterField,
  fieldValue,
  hasFilters,
  STATE_OPTIONS,
  activeState,
  withDates,
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
  filters,
  onFiltersChange,
  display,
  onDisplayChange,
  open,
  onOpenChange,
  onSaveView,
}: BuildFilterBar.Props) {
  // People's names for the author and reviewer chips, which hold user ids once a suggestion is picked.
  const members = useQuery({ ...workspaceQuery(workspace), staleTime: 60_000 })
  const labels = new Map((members.data?.members ?? []).map((m) => [m.userId, m.user.name]))
  const set = (next: BuildFilters, close = true) => {
    onFiltersChange(next)
    if (close) onOpenChange(undefined)
  }
  return (
    <div className={styles.bar} role="group" aria-label="Filters">
      {FILTER_FIELDS.map(({ field, label }) => {
        const active = fieldValue(field, filters) !== undefined
        return (
          <Popover
            key={field}
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
            <FieldEditor workspace={workspace} field={field} filters={filters} onChange={set} />
            {active ? (
              <Button size="sm" variant="ghost" onClick={() => set(without(filters, field))}>
                Clear {label.toLowerCase()}
              </Button>
            ) : null}
          </Popover>
        )
      })}
      {hasFilters(filters) ? (
        <>
          <Button size="sm" variant="ghost" onClick={() => set({})}>
            Clear filters
          </Button>
          {onSaveView ? (
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
    filters: BuildFilters
    onFiltersChange: (filters: BuildFilters) => void
    display: DisplayOptions
    onDisplayChange: (display: DisplayOptions) => void
    /** Which popover is open (the F and ⇧V shortcuts open them). */
    open: FilterField | 'display' | undefined
    onOpenChange: (open: FilterField | 'display' | undefined) => void
    /** Omit where saving is not offered (a saved view's own page). */
    onSaveView?: (() => void) | undefined
  }
}

function FieldEditor({
  workspace,
  field,
  filters,
  onChange,
}: {
  workspace: string
  field: FilterField
  filters: BuildFilters
  onChange: (filters: BuildFilters) => void
}) {
  if (field === 'status') {
    const current = activeState(filters)
    return (
      <div role="group" aria-label="Status" className={styles.options}>
        {STATE_OPTIONS.map((o) => (
          <Button
            key={o.id}
            variant="toggle"
            size="sm"
            pressed={current?.id === o.id}
            onClick={() => onChange(withState(filters, current?.id === o.id ? undefined : o.id))}
          >
            {o.label}
          </Button>
        ))}
      </div>
    )
  }
  if (field === 'date') return <DateEditor filters={filters} onChange={onChange} />
  return <TextEditor workspace={workspace} field={field} filters={filters} onChange={onChange} />
}

function TextEditor({
  workspace,
  field,
  filters,
  onChange,
}: {
  workspace: string
  field: 'branch' | 'author' | 'reviewer' | 'name'
  filters: BuildFilters
  onChange: (filters: BuildFilters) => void
}) {
  const [text, setText] = useState(filters[field] ?? '')
  const label = FILTER_FIELDS.find((f) => f.field === field)?.label ?? field
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onChange(withText(filters, field, text))
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
      <Text variant="small" tone="secondary" id="display-group">
        Group by
      </Text>
      <div role="group" aria-labelledby="display-group" className={styles.options}>
        {GROUPS.map((g) => (
          <Button
            key={g}
            variant="toggle"
            size="sm"
            pressed={display.groupBy === g}
            onClick={() => onChange({ ...display, groupBy: g })}
          >
            {GROUP_LABEL[g]}
          </Button>
        ))}
      </div>
      <Text variant="small" tone="secondary" id="display-order">
        Order
      </Text>
      <div role="group" aria-labelledby="display-order" className={styles.options}>
        {ORDERS.map((o) => (
          <Button
            key={o}
            variant="toggle"
            size="sm"
            pressed={display.order === o}
            onClick={() => onChange({ ...display, order: o })}
          >
            {ORDER_LABEL[o]}
          </Button>
        ))}
      </div>
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

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
import { type FormEvent, type ReactNode, useDeferredValue, useState } from 'react'

import { workspaceQuery } from '#features/members/api.ts'
import { branchesQuery, suggestionsQuery } from '#features/projects/api/index.ts'

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
  suggestionChoices,
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
  project,
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
                  active={active}
                  aria-keyshortcuts={field === 'status' ? 'f' : undefined}
                >
                  {chipName(field, filters, labels)}
                </Button>
              }
            >
              <FieldEditor
                workspace={workspace}
                project={project}
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
    /** The project whose branches the Branch picker offers; without one, the workspace's. */
    project?: string | undefined
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
  project,
  field,
  filters,
  labels,
  onChange,
}: {
  workspace: string
  project: string | undefined
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
    return (
      <BranchEditor workspace={workspace} project={project} filters={filters} onChange={onChange} />
    )
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
  // Unchanged text is still the person already filtered by, not their name as free text.
  const apply = (value: string) =>
    onChange(withText(filters, field, value === currentName && current ? current : value))
  if (field === 'author' || field === 'reviewer') {
    return (
      <PersonEditor
        workspace={workspace}
        field={field}
        label={label}
        text={text}
        onTextChange={setText}
        onApply={apply}
        onPick={(value) => onChange(withText(filters, field, value))}
      />
    )
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        apply(text)
      }}
      className={styles.form}
    >
      <TextField label={label} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
      <Button type="submit" size="sm" variant="primary">
        Apply
      </Button>
    </form>
  )
}

/**
 * The typeahead both pickers share: a field that suggests while you type (the caller narrows
 * `items`), arrow keys and Enter on a highlighted suggestion pick it, Enter with none highlighted
 * applies the text, and Apply does the same. It is the `Autocomplete` wrapper in a form.
 */
function TypeaheadForm({
  label,
  listLabel,
  text,
  onTextChange,
  items,
  emptyText,
  onPick,
  onApply,
}: {
  label: string
  listLabel: string
  text: string
  onTextChange: (text: string) => void
  items: readonly string[]
  emptyText?: ReactNode
  onPick: (item: string) => void
  onApply: () => void
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onApply()
      }}
      className={styles.form}
    >
      <Autocomplete
        label={label}
        value={text}
        autoFocus
        onValueChange={onTextChange}
        items={items}
        onPick={onPick}
        listLabel={listLabel}
        {...(emptyText ? { emptyText } : {})}
      />
      <Button type="submit" size="sm" variant="primary">
        Apply
      </Button>
    </form>
  )
}

/**
 * The Branch chip's picker, like GitHub's branch select: the branches builds were made on, most
 * recent first, narrowed as you type (the server matches any part of the name, in any case).
 * Picking one filters to exactly that branch; text that is not a branch filters by branches that
 * contain it.
 */
function BranchEditor({
  workspace,
  project,
  filters,
  onChange,
}: {
  workspace: string
  project: string | undefined
  filters: BuildFilters
  onChange: (filters: BuildFilters) => void
}) {
  const [text, setText] = useState(filters.branch ?? filters.branchContains ?? '')
  const typed = useDeferredValue(text.trim())
  const { data } = useQuery({
    ...branchesQuery(workspace, project, typed),
    placeholderData: keepPreviousData,
  })
  const names = (data?.branches ?? []).map((b) => b.name)
  return (
    <TypeaheadForm
      label="Branch"
      listLabel="Branches"
      text={text}
      onTextChange={setText}
      items={names}
      onPick={(name) => onChange(withBranch(filters, name, { picked: true }))}
      onApply={() => onChange(withBranch(filters, text, { known: names }))}
      emptyText={
        data
          ? text.trim()
            ? `No branch matches “${text.trim()}”. Press Enter to filter by name.`
            : 'No branches yet.'
          : 'Loading branches'
      }
    />
  )
}

/** The author and reviewer pickers: the workspace's members and the logins seen, narrowed as you type. */
function PersonEditor({
  workspace,
  field,
  label,
  text,
  onTextChange,
  onApply,
  onPick,
}: {
  workspace: string
  field: 'author' | 'reviewer'
  label: string
  text: string
  onTextChange: (text: string) => void
  onApply: (text: string) => void
  onPick: (value: string) => void
}) {
  const typed = useDeferredValue(text.trim())
  const { data } = useQuery(suggestionsQuery(workspace, field, typed))
  const choices = suggestionChoices(data?.suggestions ?? [])
  return (
    <TypeaheadForm
      label={label}
      listLabel="Suggestions"
      text={text}
      onTextChange={onTextChange}
      items={choices.map((c) => c.label)}
      onPick={(picked) => {
        const choice = choices.find((c) => c.label === picked)
        if (choice) onPick(choice.value)
      }}
      onApply={() => onApply(text)}
    />
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

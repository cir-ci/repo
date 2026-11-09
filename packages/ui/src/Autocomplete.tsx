import { Autocomplete as BaseAutocomplete } from '@base-ui/react/autocomplete'
import { Field } from '@base-ui/react/field'
import { type ReactNode, useRef } from 'react'

import { cx } from './cx.ts'
import { visuallyHidden } from './theme.ts'

import styles from './Autocomplete.module.css'

/**
 * Provisional (docs/design-gaps.md §2): a text field that suggests values while you type, like
 * GitHub's branch select. The same label / 32px input / description / error as `TextField`, with
 * the suggestions as a listbox below it in the page's flow (no popup of its own, so it sits inside
 * a `Popover` without a second layer). Built on Base UI's `Autocomplete` inside `Field`.
 *
 * The caller owns the text (`value`, `onValueChange`) and the suggestions: it narrows `items` by
 * the text itself (the list may come from a server search), so the control does no filtering.
 * Typing is free text; arrows move through the suggestions, and Enter on a highlighted one calls
 * `onPick` with it. Enter with none highlighted submits the owning form, if any, with the text.
 */
export function Autocomplete({
  label,
  hideLabel,
  description,
  error,
  items,
  value,
  onPick,
  emptyText,
  listLabel,
  onValueChange,
  className,
  name,
  disabled,
  ...rest
}: Autocomplete.Props) {
  // Base UI keeps Enter for the highlighted suggestion; with none highlighted it is the form's.
  const highlighted = useRef<string | undefined>(undefined)
  return (
    <Field.Root
      name={name}
      invalid={error ? true : undefined}
      disabled={disabled}
      className={cx(styles.root, className)}
    >
      <Field.Label className={styles.label} style={hideLabel ? visuallyHidden : undefined}>
        {label}
      </Field.Label>
      <BaseAutocomplete.Root
        items={items}
        mode="none"
        inline
        open
        value={value}
        onValueChange={(next) => onValueChange(next)}
        onItemHighlighted={(item) => {
          highlighted.current = item
        }}
      >
        <BaseAutocomplete.Input
          {...rest}
          className={styles.control}
          autoComplete="off"
          onKeyDown={(event) => {
            rest.onKeyDown?.(event)
            if (event.key === 'Enter' && highlighted.current === undefined) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          spellCheck={false}
        />
        <BaseAutocomplete.List aria-label={listLabel} className={styles.list}>
          {(item: string) => (
            <BaseAutocomplete.Item
              key={item}
              value={item}
              className={styles.item}
              onClick={() => onPick?.(item)}
            >
              <span className={styles.itemText}>{item}</span>
            </BaseAutocomplete.Item>
          )}
        </BaseAutocomplete.List>
        {items.length === 0 && emptyText ? (
          <BaseAutocomplete.Empty className={styles.empty}>{emptyText}</BaseAutocomplete.Empty>
        ) : null}
      </BaseAutocomplete.Root>
      {error ? (
        <Field.Error match className={styles.error}>
          {error}
        </Field.Error>
      ) : description ? (
        <Field.Description className={styles.description}>{description}</Field.Description>
      ) : null}
    </Field.Root>
  )
}

export namespace Autocomplete {
  export interface Props extends Omit<
    BaseAutocomplete.Input.Props,
    | 'className'
    | 'render'
    | 'children'
    | 'aria-label'
    | 'aria-labelledby'
    | 'size'
    | 'value'
    | 'defaultValue'
    | 'onChange'
  > {
    label: ReactNode
    /** Hide the label visually; it still names the control for assistive tech. */
    hideLabel?: boolean
    /** Help under the control; hidden while there is an `error`. */
    description?: ReactNode
    /** Makes the field invalid and replaces the description. */
    error?: ReactNode
    /** The text in the input. */
    value: string
    /** The text changed because the person typed or cleared it. */
    onValueChange: (value: string) => void
    /** What to suggest now, already narrowed by the text. */
    items: readonly string[]
    /** A suggestion was chosen (by click, or Enter while highlighted). */
    onPick?: (item: string) => void
    /** Shown instead of the list when there is nothing to suggest. */
    emptyText?: ReactNode
    /** Names the list of suggestions for assistive tech. */
    listLabel?: string
    /** On the field wrapper, for layout. */
    className?: string
  }
}

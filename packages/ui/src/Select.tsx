import { Field } from '@base-ui/react/field'
import { Select as BaseSelect } from '@base-ui/react/select'
import type { ReactNode } from 'react'

import { cx } from './cx.ts'
import { CheckIcon, ExpandMoreIcon } from './icons.ts'
import { visuallyHidden } from './theme.ts'

import styles from './Select.module.css'

/**
 * Provisional (docs/design-gaps.md §2, §4): the same label / 32px control / description / error
 * as `TextField`, with a chevron; the popup looks like a `Menu`. Arrow keys and type-ahead move
 * in the list, Enter or Space picks, Escape closes. Built on Base UI's `Select` inside `Field`.
 *
 * The popup is wider than it is tall and opens below the trigger (`alignItemWithTrigger` is
 * off): a dense UI reads better when the control doesn't jump under the pointer.
 */
export function Select({
  label,
  hideLabel,
  description,
  error,
  items,
  placeholder,
  name,
  disabled,
  required,
  value,
  defaultValue,
  onValueChange,
  className,
}: Select.Props) {
  return (
    <Field.Root
      name={name}
      invalid={error ? true : undefined}
      disabled={disabled}
      className={cx(styles['root'], className)}
    >
      <Field.Label
        nativeLabel={false}
        render={<div />}
        className={styles['label']}
        style={hideLabel ? visuallyHidden : undefined}
      >
        {label}
      </Field.Label>
      <BaseSelect.Root
        items={items}
        value={value}
        defaultValue={defaultValue}
        onValueChange={(next) => {
          if (typeof next === 'string') onValueChange?.(next)
        }}
        required={required}
      >
        <BaseSelect.Trigger className={styles['trigger']}>
          <BaseSelect.Value className={styles['value']} placeholder={placeholder} />
          <BaseSelect.Icon className={styles['chevron']}>
            <ExpandMoreIcon />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner
            className={styles['positioner']}
            sideOffset={4}
            alignItemWithTrigger={false}
          >
            <BaseSelect.Popup className={styles['popup']} data-slot="select-popup">
              <BaseSelect.List className={styles['list']}>
                {items.map((item) => (
                  <BaseSelect.Item
                    key={item.value}
                    value={item.value}
                    disabled={item.disabled}
                    className={styles['item']}
                  >
                    <BaseSelect.ItemIndicator className={styles['indicator']}>
                      <CheckIcon size={14} strokeWidth={2} />
                    </BaseSelect.ItemIndicator>
                    <BaseSelect.ItemText className={styles['itemText']}>
                      {item.label}
                    </BaseSelect.ItemText>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
      {error ? (
        <Field.Error match className={styles['error']}>
          {error}
        </Field.Error>
      ) : description ? (
        <Field.Description className={styles['description']}>{description}</Field.Description>
      ) : null}
    </Field.Root>
  )
}

export namespace Select {
  export interface Item {
    value: string
    label: string
    disabled?: boolean
  }

  export interface Props {
    label: ReactNode
    /** Hide the label visually; it still names the control for assistive tech. */
    hideLabel?: boolean
    /** Help under the control; hidden while there is an `error`. */
    description?: ReactNode
    /** Makes the field invalid and replaces the description. */
    error?: ReactNode
    items: ReadonlyArray<Item>
    /** Shown while nothing is picked. */
    placeholder?: string
    name?: string
    disabled?: boolean
    required?: boolean
    value?: string
    defaultValue?: string
    onValueChange?: (value: string) => void
    /** On the field wrapper, for layout. */
    className?: string
  }
}

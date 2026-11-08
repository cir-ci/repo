import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import { CheckboxGroup as BaseCheckboxGroup } from '@base-ui/react/checkbox-group'
import { Field } from '@base-ui/react/field'
import { Fieldset } from '@base-ui/react/fieldset'
import { createContext, type ReactNode, useContext } from 'react'

import { cx } from './cx.ts'
import { CheckIcon, MinusIcon } from './icons.ts'

import styles from './Checkbox.module.css'

const InGroup = createContext(false)

/**
 * Provisional (docs/design-gaps.md §2): a 14×14 box (radius 3, checked fill `accent.main`) with
 * its label to the right; clicking the label toggles it and Space toggles it from the keyboard.
 * Inside a `CheckboxGroup` it is identified by `value`; on its own use `checked`/`defaultChecked`.
 */
export function Checkbox({ label, description, className, ...rest }: Checkbox.Props) {
  const inGroup = useContext(InGroup)
  const item = (
    <div className={cx(styles.root, className)}>
      <Field.Label className={styles.row}>
        <BaseCheckbox.Root {...rest} className={styles.box}>
          <BaseCheckbox.Indicator className={styles.indicator} keepMounted={false}>
            {rest.indeterminate ? (
              <MinusIcon size={12} strokeWidth={3} />
            ) : (
              <CheckIcon size={12} strokeWidth={3} />
            )}
          </BaseCheckbox.Indicator>
        </BaseCheckbox.Root>
        {label}
      </Field.Label>
      {description ? (
        <Field.Description className={styles.description}>{description}</Field.Description>
      ) : null}
    </div>
  )
  return inGroup ? <Field.Item>{item}</Field.Item> : <Field.Root>{item}</Field.Root>
}

export namespace Checkbox {
  export interface Props extends Omit<
    BaseCheckbox.Root.Props,
    'className' | 'render' | 'children' | 'aria-label' | 'aria-labelledby'
  > {
    label: ReactNode
    /** One line of help under the label. */
    description?: ReactNode
    className?: string
  }
}

/** A labelled group of `Checkbox`es (a `fieldset` named by `legend`) holding an array of values. */
export function CheckboxGroup({
  legend,
  name,
  value,
  defaultValue,
  onValueChange,
  disabled,
  className,
  children,
}: CheckboxGroup.Props) {
  return (
    <InGroup.Provider value={true}>
      <Field.Root name={name} disabled={disabled}>
        <Fieldset.Root
          render={
            <BaseCheckboxGroup
              value={value}
              defaultValue={defaultValue}
              onValueChange={(next) => onValueChange?.(next)}
            />
          }
          className={cx(styles.group, className)}
        >
          <Fieldset.Legend className={styles.legend}>{legend}</Fieldset.Legend>
          {children}
        </Fieldset.Root>
      </Field.Root>
    </InGroup.Provider>
  )
}

export namespace CheckboxGroup {
  export interface Props {
    legend: ReactNode
    name?: string
    value?: string[]
    defaultValue?: string[]
    onValueChange?: (value: string[]) => void
    disabled?: boolean
    className?: string
    /** `Checkbox`es with a `value`. */
    children: ReactNode
  }
}

import { Field } from '@base-ui/react/field'
import { Switch as BaseSwitch } from '@base-ui/react/switch'
import type { ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './Switch.module.css'

/**
 * A 32×18 switch with its label to the right (Space toggles it). Only for a setting that takes
 * effect the moment it flips; a setting that needs a Save button is a `Checkbox`.
 */
export function Switch({ label, description, className, ...rest }: Switch.Props) {
  return (
    <Field.Root>
      <div className={cx(styles['root'], className)}>
        <Field.Label className={styles['row']}>
          <span className={styles['text']}>
            {label}
            {description ? <span className={styles['description']}>{description}</span> : null}
          </span>
          <BaseSwitch.Root {...rest} className={styles['track']}>
            <BaseSwitch.Thumb className={styles['thumb']} />
          </BaseSwitch.Root>
        </Field.Label>
      </div>
    </Field.Root>
  )
}

export namespace Switch {
  export interface Props extends Omit<
    BaseSwitch.Root.Props,
    'className' | 'render' | 'children' | 'aria-label' | 'aria-labelledby'
  > {
    label: ReactNode
    /** One line of help under the label. */
    description?: ReactNode
    className?: string
  }
}

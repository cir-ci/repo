import { cx } from './cx.ts'
import { Ref } from './Ref.tsx'
import { Text } from './Text.tsx'

import styles from './SecretBox.module.css'

/**
 * A secret shown once (CI token, signing secret): a small label over the value in a `Ref`, which
 * wraps instead of truncating (a token is read and checked) and has the copy button.
 */
export function SecretBox({ label, value, className, ...rest }: SecretBox.Props) {
  return (
    <div {...rest} className={cx(styles.root, className)}>
      <Text variant="small" tone="secondary">
        {label}
      </Text>
      <Ref value={value} label={label} className={styles.value} />
    </div>
  )
}

export namespace SecretBox {
  export interface Props extends Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> {
    /** What the secret is; also names the copy button ("Copy <label>"). */
    label: string
    value: string
  }
}

import { Ref, Text } from '@circi/ui'

import styles from './SecretBox.module.css'

/** A secret shown once (CI token, signing secret), with a way to copy it. */
export function SecretBox({ label, value }: SecretBox.Props) {
  return (
    <div className={styles.secret}>
      <Text variant="small" tone="secondary">
        {label}
      </Text>
      <Ref value={value} label={label} className={styles.value} />
    </div>
  )
}

export namespace SecretBox {
  export interface Props {
    label: string
    value: string
  }
}

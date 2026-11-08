import type { ReactNode } from 'react'

import { STATUS_LABEL, type Status, StatusIcon } from './StatusIcon.tsx'

import styles from './StatusChip.module.css'

/** A small pill pairing a status glyph with its word: "Needs review", "4 changed". */
export function StatusChip(props: StatusChip.Props) {
  return (
    <span className={styles['root']}>
      {/* With custom text the glyph is decoration: "Expired" shouldn't read "No changes Expired". */}
      <StatusIcon
        status={props.status}
        size={10}
        label={STATUS_LABEL[props.status]}
        decorative={props.children !== undefined}
      />
      {props.children ?? STATUS_LABEL[props.status]}
    </span>
  )
}

export namespace StatusChip {
  export interface Props {
    status: Status
    /** Text beside the glyph (the glyph is then hidden from assistive tech); defaults to the status's label. */
    children?: ReactNode
  }
}

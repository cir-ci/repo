import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import type { ReactNode } from 'react'

import styles from './SegmentedControl.module.css'

/**
 * A choice between a few views of the same thing (Side by side · Overlay · Diff). Base UI's
 * `ToggleGroup`: the options are `aria-pressed` buttons, arrow keys move between them, and one
 * is always chosen once one is (pressing the chosen one again does nothing). With no `value` none is
 * chosen yet, as for a filter that is not set. `wrap` lets the options flow onto more rows when
 * they do not fit one.
 */
export function SegmentedControl(props: SegmentedControl.Props) {
  return (
    <ToggleGroup
      className={styles.root}
      data-fill={props.fill ? '' : undefined}
      data-wrap={props.wrap ? '' : undefined}
      aria-label={props.label}
      value={props.value === undefined ? [] : [props.value]}
      onValueChange={(next) => {
        const [chosen] = next
        if (chosen !== undefined) props.onChange(chosen)
      }}
    >
      {props.options.map((o) => (
        <Toggle key={o.value} value={o.value} className={styles.item}>
          {o.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}

export namespace SegmentedControl {
  export interface Option {
    value: string
    /** What the option shows: its name, with a count if it has one. */
    label: ReactNode
  }
  export interface Props {
    options: readonly Option[]
    /** The chosen option; none while undefined. */
    value: string | undefined
    onChange: (value: string) => void
    /** Accessible name of the group. */
    label: string
    /** Stretch to the width of the container, the options sharing it equally. */
    fill?: boolean
    /** Let the options wrap onto further rows instead of widening the control. */
    wrap?: boolean
  }
}

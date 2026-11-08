import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'

import styles from './SegmentedControl.module.css'

/**
 * A choice between a few views of the same thing (Side by side · Overlay · Diff). Base UI's
 * `ToggleGroup`: the options are `aria-pressed` buttons, arrow keys move between them, and one
 * is always chosen (pressing the chosen one again does nothing).
 */
export function SegmentedControl(props: SegmentedControl.Props) {
  return (
    <ToggleGroup
      className={styles.root}
      aria-label={props.label}
      value={[props.value]}
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
    label: string
  }
  export interface Props {
    options: readonly Option[]
    value: string
    onChange: (value: string) => void
    /** Accessible name of the group. */
    label: string
  }
}

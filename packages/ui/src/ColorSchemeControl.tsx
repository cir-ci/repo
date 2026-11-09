import { useColorScheme } from './CirciTheme.tsx'
import { isColorMode } from './color-scheme.ts'
import { SegmentedControl } from './SegmentedControl.tsx'

const OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

/** Lets the viewer pick light, dark, or the system's scheme. Must sit inside `CirciTheme`. */
export function ColorSchemeControl({ fill = false }: ColorSchemeControl.Props) {
  const { mode, setMode } = useColorScheme()
  return (
    <SegmentedControl
      label="Theme"
      fill={fill}
      options={OPTIONS}
      value={mode}
      onChange={(v) => {
        if (isColorMode(v)) setMode(v)
      }}
    />
  )
}

export namespace ColorSchemeControl {
  export interface Props {
    /** Fill the width of the container, the three options equal (the account menu). */
    fill?: boolean
  }
}

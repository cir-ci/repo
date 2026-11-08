import { SegmentedControl } from '@circi/ui'
import { useState } from 'react'

const MODES = [
  { value: 'side', label: 'Side by side' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'diff', label: 'Diff' },
]

function Demo(props: { initial: string }) {
  const [value, setValue] = useState(props.initial)
  return <SegmentedControl label="Compare mode" options={MODES} value={value} onChange={setValue} />
}

export const SideBySide = () => (
  <div style={{ padding: 24 }}>
    <Demo initial="side" />
  </div>
)

export const DiffSelected = () => (
  <div style={{ padding: 24 }}>
    <Demo initial="diff" />
  </div>
)

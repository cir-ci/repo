import { StatusChip } from '@circi/ui'

export const BuildStates = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 24 }}>
    <StatusChip status="approved" />
    <StatusChip status="needs-review" />
    <StatusChip status="processing" />
    <StatusChip status="rejected" />
    <StatusChip status="neutral" />
  </div>
)

export const WithCounts = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 24 }}>
    <StatusChip status="needs-review">4 changed</StatusChip>
    <StatusChip status="approved">1 added</StatusChip>
    <StatusChip status="rejected">2 removed</StatusChip>
  </div>
)

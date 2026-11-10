import { StatusIcon, type Status } from '@circi/ui'

const ALL: Status[] = ['approved', 'needs-review', 'processing', 'failed', 'rejected', 'neutral']

/** Every state side by side: shape, not just colour, tells them apart. */
export const AllStates = () => (
  <div style={{ display: 'flex', gap: 32, padding: 24 }}>
    {ALL.map((s) => (
      <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <StatusIcon status={s} />
        <span>{s}</span>
      </div>
    ))}
  </div>
)

export const Large = () => (
  <div style={{ display: 'flex', gap: 20, padding: 24 }}>
    {ALL.map((s) => (
      <StatusIcon key={s} status={s} size={32} />
    ))}
  </div>
)

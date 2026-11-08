import { ListRow, StatusIcon } from '@circi/ui'

const meta = { fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: 12, opacity: 0.7 }

export const BuildList = () => (
  <div style={{ width: 640, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
    <ListRow
      href="#148"
      leading={<StatusIcon status="needs-review" />}
      trailing={<span style={meta}>feat/checkout · 2m</span>}
    >
      <strong style={{ fontWeight: 500 }}>#148</strong> Add payment form validation
    </ListRow>
    <ListRow
      href="#147"
      leading={<StatusIcon status="approved" />}
      trailing={<span style={meta}>main · 1h</span>}
    >
      <strong style={{ fontWeight: 500 }}>#147</strong> Bump design tokens
    </ListRow>
    <ListRow
      href="#146"
      leading={<StatusIcon status="processing" />}
      trailing={<span style={meta}>settings-dark · now</span>}
    >
      <strong style={{ fontWeight: 500 }}>#146</strong> Dark mode for settings
    </ListRow>
    <ListRow
      href="#145"
      leading={<StatusIcon status="rejected" />}
      trailing={<span style={meta}>compact-tables · 5h</span>}
    >
      <strong style={{ fontWeight: 500 }}>#145</strong> Experiment: compact tables
    </ListRow>
  </div>
)

export const Selected = () => (
  <div style={{ width: 420, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
    <ListRow onClick={() => {}} leading={<StatusIcon status="needs-review" />}>
      checkout / payment-form
    </ListRow>
    <ListRow selected onClick={() => {}} leading={<StatusIcon status="approved" />}>
      checkout / summary
    </ListRow>
    <ListRow onClick={() => {}} leading={<StatusIcon status="needs-review" />}>
      nav / header · mobile
    </ListRow>
  </div>
)

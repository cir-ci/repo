import {
  COLOR_SCHEME_ATTRIBUTE,
  ListRow,
  palettes,
  StatusChip,
  StatusIcon,
  tokens,
} from '@circi/ui'

/** The theme gives every component the warm ground and the logo-derived accent (dark shown). */
export const Ground = () => (
  <div
    style={{
      padding: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      background: tokens.surface.panel,
    }}
  >
    <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
      Visual regression testing you host yourself
    </h1>
    <p style={{ margin: 0, color: tokens.text.secondary }}>
      Builds on main become the baselines that pull requests are compared with.
    </p>
    <div style={{ display: 'flex', gap: 8 }}>
      <StatusChip status="approved" />
      <StatusChip status="needs-review" />
    </div>
  </div>
)

export const Palette = () => (
  <div style={{ display: 'flex', gap: 8, padding: 24 }}>
    {Object.entries(palettes.dark.brand).map(([name, hex]) => (
      <div key={name} style={{ width: 88 }}>
        <div style={{ height: 48, borderRadius: 8, background: hex }} />
        <div style={{ fontSize: 12, marginTop: 6 }}>{name}</div>
        <div style={{ fontSize: 11, opacity: 0.6 }}>{hex}</div>
      </div>
    ))}
  </div>
)

/**
 * The light scheme. Any subtree can be pinned to a scheme with the attribute, because every
 * token is a CSS variable; the app sets it on <html>.
 */
export const Light = () => (
  <div
    {...{ [COLOR_SCHEME_ATTRIBUTE]: 'light' }}
    style={{ padding: 24, background: tokens.surface.chrome, color: tokens.text.primary }}
  >
    <div
      style={{
        background: tokens.surface.panel,
        border: `1px solid ${tokens.line.subtle}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <ListRow
        leading={<StatusIcon status="approved" />}
        trailing={<StatusChip status="approved" />}
      >
        Add payment form validation
      </ListRow>
      <ListRow
        selected
        leading={<StatusIcon status="needs-review" />}
        trailing={<StatusChip status="needs-review" />}
      >
        Checkout redesign
      </ListRow>
      <ListRow
        leading={<StatusIcon status="rejected" />}
        trailing={<StatusChip status="rejected" />}
      >
        Bump Base UI
      </ListRow>
    </div>
  </div>
)

import { PanelHeader, StatusChip, tokens } from '@circi/ui'

const btn = {
  height: 28,
  padding: '0 10px',
  borderRadius: 6,
  border: `1px solid ${tokens.line.strong}`,
  background: tokens.surface.raised,
  color: 'inherit',
  font: '500 12px inherit',
} as const

export const Breadcrumb = () => (
  <div style={{ width: 760 }}>
    <PanelHeader
      actions={
        <>
          <StatusChip status="needs-review" />
          <button style={btn}>Reject</button>
          <button
            style={{
              ...btn,
              background: tokens.accent.main,
              border: 0,
              color: tokens.accent.onAccent,
            }}
          >
            Approve all
          </button>
        </>
      }
    >
      <span style={{ opacity: 0.7 }}>web-app</span>
      <span style={{ opacity: 0.5 }}>/</span>
      <span>Build #148</span>
    </PanelHeader>
  </div>
)

export const PlainTitle = () => (
  <div style={{ width: 760 }}>
    <PanelHeader
      actions={
        <button
          style={{
            ...btn,
            background: tokens.accent.main,
            border: 0,
            color: tokens.accent.onAccent,
          }}
        >
          New project
        </button>
      }
    >
      Projects
    </PanelHeader>
  </div>
)

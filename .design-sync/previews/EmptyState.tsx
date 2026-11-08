import { COLOR_SCHEME_ATTRIBUTE, tokens, EmptyState, Button } from '@circi/ui'
import type { ReactNode } from 'react'

/** The same content in both schemes: any subtree can be pinned with the attribute. */
const Both = (props: { children: ReactNode; width?: number }) => (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    {(['dark', 'light'] as const).map((scheme) => (
      <div
        key={scheme}
        {...{ [COLOR_SCHEME_ATTRIBUTE]: scheme }}
        style={{
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          background: tokens.surface.panel,
          color: tokens.text.primary,
          fontSize: 13,
          width: props.width,
        }}
      >
        {props.children}
      </div>
    ))}
  </div>
)

export const Empty = () => (
  <Both width={480}>
    <EmptyState title="No teams yet" action={<Button variant="primary">New team</Button>}>
      Create a team to start comparing builds.
    </EmptyState>
  </Both>
)

export const Error = () => (
  <Both width={480}>
    <EmptyState
      title="This build doesn’t exist"
      tone="rejected"
      action={<Button>Back to Teams</Button>}
    >
      It may have expired, or the link is wrong.
    </EmptyState>
  </Both>
)

import { COLOR_SCHEME_ATTRIBUTE, tokens, Pane, Button } from '@circi/ui'
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

export const Default = () => (
  <Both width={460}>
    <Pane
      label="Preview"
      context="login.png"
      width="md"
      actions={
        <>
          <Button>Reject</Button>
          <Button variant="primary">Approve</Button>
        </>
      }
    >
      The snapshot differs from its baseline by 0.4%.
    </Pane>
  </Both>
)

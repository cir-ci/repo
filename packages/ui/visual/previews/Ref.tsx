import { COLOR_SCHEME_ATTRIBUTE, tokens, Ref } from '@circi/ui'
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

export const Values = () => (
  <Both>
    <Ref value="3f9c2ab81d0e5a47" display="3f9c2ab" label="SHA" />
    <Ref value="feature/payment-form-validation" label="branch" />
    <Ref value="circi_live_9f2a7c0d41" label="token" />
  </Both>
)

import { COLOR_SCHEME_ATTRIBUTE, tokens, Banner, Button } from '@circi/ui'
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

export const Tones = () => (
  <Both width={560}>
    <Banner tone="info" title="Processing.">
      Comparing 42 screenshots with the baseline.
    </Banner>
    <Banner tone="success" title="Approved.">
      Build #148 is the new baseline for main.
    </Banner>
    <Banner tone="warning" title="Needs review." action={<Button size="sm">Review</Button>}>
      6 screenshots changed.
    </Banner>
    <Banner tone="danger" title="Upload failed." action={<Button size="sm">Retry</Button>}>
      The CI token was rejected.
    </Banner>
  </Both>
)

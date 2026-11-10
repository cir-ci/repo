import { COLOR_SCHEME_ATTRIBUTE, tokens, Badge } from '@circi/ui'
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
  <Both>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Badge>3</Badge>
      <Badge tone="accent">12</Badge>
      <Badge tone="state" state="approved">
        2
      </Badge>
    </div>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Badge shape="tag">Draft</Badge>
      <Badge shape="tag" tone="accent">
        New
      </Badge>
      <Badge shape="tag" tone="state" state="approved">
        Approved
      </Badge>
      <Badge shape="tag" tone="state" state="review">
        Overdue 2h
      </Badge>
      <Badge shape="tag" tone="state" state="processing">
        Processing
      </Badge>
      <Badge shape="tag" tone="state" state="failed">
        Failed
      </Badge>
      <Badge shape="tag" tone="state" state="rejected">
        Rejected
      </Badge>
    </div>
  </Both>
)

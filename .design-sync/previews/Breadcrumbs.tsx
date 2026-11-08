import { COLOR_SCHEME_ATTRIBUTE, tokens, Breadcrumbs } from '@circi/ui'
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

export const Trail = () => (
  <Both>
    <Breadcrumbs
      items={[
        { label: 'Projects', href: '#' },
        { label: 'web-app', href: '#' },
        { label: 'Build #148' },
      ]}
    />
  </Both>
)

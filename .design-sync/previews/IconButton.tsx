import { COLOR_SCHEME_ATTRIBUTE, tokens, IconButton } from '@circi/ui'
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
  <Both>
    <div style={{ display: 'flex', gap: 8 }}>
      <IconButton label="Close">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
        </svg>
      </IconButton>
      <IconButton label="More" disabled>
        <svg viewBox="0 0 16 16" fill="currentColor">
          <circle cx="3" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="13" cy="8" r="1.25" />
        </svg>
      </IconButton>
    </div>
  </Both>
)

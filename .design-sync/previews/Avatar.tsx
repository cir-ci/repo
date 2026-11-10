import { COLOR_SCHEME_ATTRIBUTE, tokens, Avatar } from '@circi/ui'
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

export const Sizes = () => (
  <Both>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Avatar name="Ada Lovelace" />
      <Avatar name="Grace Hopper" size={32} />
      <Avatar name="ada@example.com" size={40} />
    </div>
  </Both>
)

export const Generated = () => (
  <Both>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {['user-1', 'user-2', 'user-3', 'user-4', 'user-5', 'user-6', 'user-7', 'user-8'].map(
        (id) => (
          <Avatar key={id} name={id} seed={id} size={32} />
        ),
      )}
    </div>
  </Both>
)

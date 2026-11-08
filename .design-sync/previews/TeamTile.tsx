import { COLOR_SCHEME_ATTRIBUTE, tokens, TeamTile } from '@circi/ui'
import type { ReactNode } from 'react'

/** The same content in both schemes: any subtree can be pinned with the attribute. */
const Both = (props: { children: ReactNode }) => (
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
        }}
      >
        {props.children}
      </div>
    ))}
  </div>
)

const COLORS = ['slate', 'olive', 'plum', 'moss', 'mauve', 'graphite'] as const

export const Sizes = () => (
  <Both>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <TeamTile name="Web app" color="slate" size={16} />
      <TeamTile name="Storefront" color="plum" size={20} />
      <TeamTile name="Mobile" color="olive" size={24} />
      <TeamTile name="Design system" color="moss" size={40} />
    </div>
  </Both>
)

export const Icons = () => (
  <Both>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <TeamTile name="Web app" color="slate" icon="globe" size={16} />
      <TeamTile name="Storefront" color="plum" icon="shopping-cart" size={20} />
      <TeamTile name="Mobile" color="olive" icon="smartphone" size={24} />
      <TeamTile name="Design system" color="moss" icon="component" size={40} />
    </div>
  </Both>
)

export const Palette = () => (
  <Both>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {COLORS.map((color) => (
        <TeamTile key={color} name={color} color={color} size={24} />
      ))}
    </div>
  </Both>
)

import { COLOR_SCHEME_ATTRIBUTE, tokens, WorkspaceTile } from '@circi/ui'
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

const SLUGS = ['acme', 'side-project', 'northwind', 'initech', 'globex', 'umbrella'] as const

export const Sizes = () => (
  <Both>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <WorkspaceTile seed="acme" size={16} />
      <WorkspaceTile seed="acme" size={20} />
      <WorkspaceTile seed="acme" size={24} />
    </div>
  </Both>
)

export const Seeds = () => (
  <Both>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {SLUGS.map((slug) => (
        <WorkspaceTile key={slug} seed={slug} size={24} />
      ))}
    </div>
  </Both>
)

export const WithPicture = () => (
  <Both>
    <WorkspaceTile
      seed="acme"
      size={24}
      picture="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 4'%3E%3Crect width='4' height='4' fill='gray'/%3E%3C/svg%3E"
    />
  </Both>
)

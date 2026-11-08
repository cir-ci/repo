import { COLOR_SCHEME_ATTRIBUTE, tokens, AnnouncerProvider, useAnnounce, Button } from '@circi/ui'
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

const Announce = () => {
  const announce = useAnnounce()
  return <Button onClick={() => announce('Build approved')}>Announce “Build approved”</Button>
}

/** The live region is visually hidden: a screen reader hears the message, the page shows nothing. */
export const Region = () => (
  <Both>
    <AnnouncerProvider>
      <Announce />
    </AnnouncerProvider>
  </Both>
)

import { COLOR_SCHEME_ATTRIBUTE, tokens, Select } from '@circi/ui'
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

const ROLES = [
  { value: 'owner', label: 'Owner' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
]

export const States = () => (
  <Both width={320}>
    <Select label="Role" items={ROLES} placeholder="Pick a role" description="What they may do." />
    <Select label="Role" items={ROLES} defaultValue="member" />
    <Select label="Role" items={ROLES} error="Pick a role" />
    <Select label="Role" items={ROLES} defaultValue="owner" disabled />
  </Both>
)

/** The label stays in the accessible name; only its text is visually hidden. */
export const HiddenLabel = () => (
  <Both width={160}>
    <Select label="Role of Ada Lovelace" hideLabel items={ROLES} defaultValue="member" />
  </Both>
)

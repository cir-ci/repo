import { COLOR_SCHEME_ATTRIBUTE, tokens, Checkbox, CheckboxGroup } from '@circi/ui'
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

export const States = () => (
  <Both>
    <Checkbox label="Notify me" defaultChecked />
    <Checkbox label="Notify me" description="By email, once per build." />
    <Checkbox label="All events" indeterminate />
    <Checkbox label="Disabled" disabled />
  </Both>
)

export const Group = () => (
  <Both>
    <CheckboxGroup legend="Events" defaultValue={['build.complete']}>
      <Checkbox label="Build complete" value="build.complete" />
      <Checkbox label="Build approved" value="build.approved" />
      <Checkbox label="Build rejected" value="build.rejected" />
    </CheckboxGroup>
  </Both>
)

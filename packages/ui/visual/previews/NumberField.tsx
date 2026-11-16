import { COLOR_SCHEME_ATTRIBUTE, tokens, NumberField } from '@circi/ui'
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
          gap: 16,
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
  <Both width={280}>
    <NumberField label="Overdue after" defaultValue={24} unit="hours" min={1} />
    <NumberField
      label="Keep builds for"
      defaultValue={30}
      unit="days"
      description="Older builds expire."
    />
    <NumberField label="Diff threshold" defaultValue={0.1} unit="%" step="any" />
    <NumberField label="Retention" defaultValue={0} error="Enter at least 1 day." />
    <NumberField label="Locked" defaultValue={5} disabled />
  </Both>
)

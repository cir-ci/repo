import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { NumberField, SettingsPage, SettingsRow, SettingsSection, TextField } from '#src/index.ts'

/** A settings page in a box `width` px wide: the container the layout measures, not the window. */
function Page({ width }: { width: number }) {
  return (
    <div style={{ width }}>
      <SettingsPage title="General">
        <SettingsSection title="Branch">
          <SettingsRow>
            <TextField label="Default branch" description="Where baselines come from." />
          </SettingsRow>
          <SettingsRow>
            <NumberField label="Retention" description="Days kept." unit="days" />
          </SettingsRow>
        </SettingsSection>
        <SettingsSection title="Merge gate">
          <SettingsRow label="Block merging" detail="While changes wait for review.">
            <button type="button">Edit</button>
          </SettingsRow>
        </SettingsSection>
      </SettingsPage>
    </div>
  )
}

function rect(element: Element | null | undefined) {
  if (!element) throw new Error('element not found')
  return element.getBoundingClientRect()
}

describe('settings form layout', () => {
  it('puts the label column beside the control when the page is 1000px wide', async () => {
    const { container } = await render(<Page width={1000} />)
    const label = container.querySelector('label')
    const input = container.querySelector('input')
    expect(rect(input).left).toBeGreaterThan(rect(label).right)
    // The label and the control start on the same line; the help is under the label.
    expect(Math.abs(rect(input).top - rect(label).top)).toBeLessThan(8)
    const help = [...container.querySelectorAll('p')].find((p) =>
      p.textContent?.startsWith('Where baselines'),
    )
    expect(rect(help ?? null).top).toBeGreaterThan(rect(label).bottom - 1)
    expect(rect(help ?? null).right).toBeLessThanOrEqual(rect(input).left)
    // The column is 240px wide.
    expect(Math.round(rect(input).left - rect(label).left)).toBe(240 + 24)
    // A row with a label of its own does the same.
    const rowLabel = [...container.querySelectorAll('span')].find(
      (s) => s.textContent === 'Block merging',
    )
    expect(rect(container.querySelector('button')).left).toBeGreaterThan(
      rect(rowLabel ?? null).right,
    )
    // The number field's label and control are in two columns too.
    const numberLabel = [...container.querySelectorAll('label')].find(
      (l) => l.textContent === 'Retention',
    )
    expect(rect(container.querySelectorAll('input')[1]).left).toBeGreaterThan(
      rect(numberLabel ?? null).right,
    )
  })

  it('stacks the label over the control at 700px', async () => {
    const { container } = await render(<Page width={700} />)
    const label = container.querySelector('label')
    const input = container.querySelector('input')
    expect(rect(input).top).toBeGreaterThanOrEqual(rect(label).bottom - 1)
    expect(Math.round(rect(input).left)).toBe(Math.round(rect(label).left))
    const numberLabel = [...container.querySelectorAll('label')].find(
      (l) => l.textContent === 'Retention',
    )
    expect(rect(container.querySelectorAll('input')[1]).top).toBeGreaterThanOrEqual(
      rect(numberLabel ?? null).bottom - 1,
    )
  })

  it('goes by the width of the page, not the window', async () => {
    const { container } = await render(<Page width={899} />)
    expect(rect(container.querySelector('input')).top).toBeGreaterThanOrEqual(
      rect(container.querySelector('label')).bottom - 1,
    )
  })
})

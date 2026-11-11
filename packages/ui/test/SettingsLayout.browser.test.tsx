import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import {
  NumberField,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  Switch,
  TextField,
} from '#src/index.ts'

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
          <SettingsRow label="Review target" detail="How long a request may wait.">
            <NumberField label="Hours" hideLabel unit="hours" />
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

  it('keeps an action row (a lone button) inline: the text takes the room, the button the right edge', async () => {
    const { container } = await render(
      <div style={{ width: 1000 }}>
        <SettingsPage title="General">
          <SettingsSection title="Danger zone" tone="danger">
            <SettingsRow
              label="Delete workspace"
              detail="Hides it for everyone at once: its teams, builds, hosted sites and CI tokens stop working, and everything is deleted for good after 30 days."
            >
              <button type="button">Delete workspace</button>
            </SettingsRow>
          </SettingsSection>
        </SettingsPage>
      </div>,
    )
    const row = container.querySelector('[data-layout="labelled"]')
    const detail = [...container.querySelectorAll('span')].find((s) =>
      s.textContent?.startsWith('Hides it'),
    )
    const button = container.querySelector('button')
    // The description is not squeezed into the 240px label column…
    expect(rect(detail ?? null).width).toBeGreaterThan(400)
    // …and the button sits at the row's right edge.
    expect(Math.round(rect(row).right - rect(button).right)).toBeLessThanOrEqual(24)
    expect(rect(button).left).toBeGreaterThan(rect(detail ?? null).right - 1)
  })

  it('keeps a switch row inline too: its text takes the room, the switch the right edge', async () => {
    const { container } = await render(
      <div style={{ width: 1000 }}>
        <SettingsPage title="Notifications">
          <SettingsSection title="Email">
            <SettingsRow
              label="A review is waiting"
              detail="An email when a build asks for your review and nobody has looked at it for a while."
            >
              <Switch label="Email: a review is waiting" />
            </SettingsRow>
          </SettingsSection>
        </SettingsPage>
      </div>,
    )
    const row = container.querySelector('[data-layout="labelled"]')
    const toggle = container.querySelector('[role="switch"]')
    expect(rect(toggle).left).toBeGreaterThan(rect(row).left + 600)
    expect(Math.round(rect(row).right - rect(toggle).right)).toBeLessThanOrEqual(24)
  })
})

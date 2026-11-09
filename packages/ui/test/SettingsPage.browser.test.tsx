import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import {
  Badge,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSummary,
  Switch,
} from '#src/index.ts'

function found(element: Element | null | undefined): Element {
  if (!element) throw new Error('element not found')
  return element
}

describe('SettingsPage', () => {
  it('is a 720px centred column with an h1, description and actions', async () => {
    const { container } = await render(
      <SettingsPage
        title="Health"
        description="Same checks as doctor."
        actions={<button>Run</button>}
      >
        <p>Body</p>
      </SettingsPage>,
    )
    await expect.element(page.getByRole('heading', { name: 'Health', level: 1 })).toBeVisible()
    await expect.element(page.getByText('Same checks as doctor.')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Run' })).toBeVisible()
    const root = container.firstElementChild
    const style = getComputedStyle(found(root))
    expect([style.maxWidth, style.marginLeft, style.rowGap]).toEqual([
      '720px',
      style.marginRight,
      '40px',
    ])
    expect([style.paddingTop, style.paddingBottom]).toEqual(['40px', '64px'])
  })

  it('width="wide" allows 1040px', async () => {
    const { container } = await render(<SettingsPage width="wide">x</SettingsPage>)
    expect(getComputedStyle(found(container.firstElementChild)).maxWidth).toBe('1040px')
  })

  it('has no header without a title, description or actions', async () => {
    const { container } = await render(<SettingsPage>x</SettingsPage>)
    expect(container.querySelector('header')).toBeNull()
  })
})

describe('SettingsSection and SettingsRow', () => {
  it('is a region named by its h2, with rows and a status badge', async () => {
    await render(
      <SettingsSection title="Mail" description="Goes out through this server.">
        <SettingsRow
          label="Server"
          detail="Accepted a test connection."
          env="SMTP_HOST"
          value="smtp.acme.io:587"
          status={<Badge shape="tag">Done</Badge>}
        />
        <SettingsRow label="Test">
          <button>Send</button>
        </SettingsRow>
      </SettingsSection>,
    )
    await expect.element(page.getByRole('region', { name: 'Mail' })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'Mail', level: 2 })).toBeVisible()
    await expect.element(page.getByText('Goes out through this server.')).toBeVisible()
    await expect.element(page.getByText('Accepted a test connection.')).toBeVisible()
    await expect.element(page.getByText('smtp.acme.io:587')).toBeVisible()
    await expect.element(page.getByText('Done')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Send' })).toBeVisible()
  })

  it('danger tone changes the box border colour', async () => {
    const { container } = await render(
      <>
        <SettingsSection title="Plain">
          <SettingsRow label="a" />
        </SettingsSection>
        <SettingsSection title="Danger zone" tone="danger">
          <SettingsRow label="b" />
        </SettingsSection>
      </>,
    )
    const [plain, danger] = [...container.querySelectorAll('section')].map(
      (s) => getComputedStyle(found(s.lastElementChild)).borderTopColor,
    )
    expect(danger).not.toBe(plain)
    await expect.element(page.getByRole('region', { name: 'Danger zone' })).toBeVisible()
  })

  it('a row stacks its value under the label at phone width', async () => {
    await render(
      <div style={{ width: 360 }}>
        <SettingsRow label="Storage" value="/var/lib/circi/files" />
      </div>,
    )
    const label = page.getByText('Storage').element().getBoundingClientRect()
    const value = page.getByText('/var/lib/circi/files').element().getBoundingClientRect()
    expect(value.top).toBeGreaterThanOrEqual(label.bottom)
  })
})

describe('SettingsRow controls', () => {
  it('puts a Switch child at the right edge, with its text taking the rest', async () => {
    await render(
      <div style={{ width: 640 }}>
        <SettingsRow data-testid="row">
          <Switch label="Password" description="Email and password." />
        </SettingsRow>
      </div>,
    )
    const row = page.getByTestId('row').element().getBoundingClientRect()
    const track = page.getByRole('switch').element().getBoundingClientRect()
    const label = page.getByText('Email and password.').element().getBoundingClientRect()
    // 16px of row padding on the right; the track ends there, the text starts at the left padding.
    expect(Math.round(row.right - track.right)).toBe(16)
    expect(Math.round(label.left - row.left)).toBe(16)
  })

  it('keeps a control at the right edge of a labelled row, also when the row wraps', async () => {
    await render(
      <div style={{ width: 640 }}>
        <SettingsRow data-testid="row" label="Test" detail="Short.">
          <button>Send</button>
        </SettingsRow>
        <SettingsRow data-testid="narrow" label={'x'.repeat(40)} style={{ width: 260 }}>
          <button>Go</button>
        </SettingsRow>
      </div>,
    )
    for (const [id, name] of [
      ['row', 'Send'],
      ['narrow', 'Go'],
    ] as const) {
      const row = page.getByTestId(id).element().getBoundingClientRect()
      const button = page.getByRole('button', { name }).element().getBoundingClientRect()
      expect(Math.round(row.right - button.right)).toBe(16)
    }
  })
})

describe('SettingsSummary', () => {
  it('is a description list of counts', async () => {
    await render(
      <SettingsSummary
        items={[
          { label: 'Passing', value: 4, extra: <Badge shape="tag">Passing</Badge> },
          { label: 'Failing', value: 0 },
        ]}
      />,
    )
    await expect.element(page.getByText('Passing').first()).toBeVisible()
    await expect.element(page.getByText('4')).toBeVisible()
    await expect.element(page.getByText('Failing')).toBeVisible()
  })
})

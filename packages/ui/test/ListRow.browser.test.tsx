import type { MouseEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { ListRow } from '#src/index.ts'

describe('ListRow', () => {
  it('is a link with an href and a button with only onClick', async () => {
    const onClick = vi.fn<(event: MouseEvent<HTMLElement>) => void>()
    await render(
      <>
        <ListRow href="/a">Link row</ListRow>
        <ListRow onClick={onClick}>Button row</ListRow>
      </>,
    )
    await expect.element(page.getByRole('link', { name: 'Link row' })).toHaveAttribute('href', '/a')
    await page.getByRole('button', { name: 'Button row' }).click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('hands onClick the click event, so a link row can navigate client-side', async () => {
    const onClick = vi.fn<(event: MouseEvent<HTMLElement>) => void>((event) => {
      event.preventDefault()
    })
    await render(
      <ListRow href="/a" onClick={onClick}>
        Link row
      </ListRow>,
    )
    await page.getByRole('link', { name: 'Link row' }).click()
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick.mock.calls[0]?.[0].defaultPrevented).toBe(true)
    expect(onClick.mock.calls[0]?.[0].type).toBe('click')
  })

  it('is a plain, non-interactive row otherwise, at least 44px high', async () => {
    await render(<ListRow>Static</ListRow>)
    expect(page.getByRole('link').elements()).toHaveLength(0)
    expect(page.getByRole('button').elements()).toHaveLength(0)
    const row = page.getByText('Static').element().parentElement
    expect(row?.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  })

  it('shows leading and trailing content and marks the selected row', async () => {
    await render(
      <ListRow href="/a" selected leading={<span>L</span>} trailing={<span>T</span>}>
        Row
      </ListRow>,
    )
    const row = page.getByRole('link')
    await expect.element(row).toHaveAttribute('aria-current', 'true')
    await expect.element(row).toHaveTextContent('LRowT')
  })
})

describe('ListRow focus, selection and density', () => {
  it('shows the accent-text ring inset 5px and the 2px accent bar on a focused selected row', async () => {
    await render(
      <ListRow href="/a" selected>
        Row
      </ListRow>,
    )
    await userEvent.tab()
    await expect.element(page.getByRole('link')).toHaveFocus()
    const style = getComputedStyle(page.getByRole('link').element())
    expect(style.outlineWidth).toBe('2px')
    expect(style.outlineOffset).toBe('-5px')
    const probe = document.createElement('span')
    probe.style.color = 'var(--circi-accent-text)'
    document.body.append(probe)
    expect(style.outlineColor).toBe(getComputedStyle(probe).color)
    probe.remove()
    expect(style.boxShadow).toContain('2px 0px 0px 0px inset')
  })

  it('sets the minimum height from the density', async () => {
    await render(
      <>
        <ListRow density="compact">A</ListRow>
        <ListRow>B</ListRow>
        <ListRow density="two-line">C</ListRow>
      </>,
    )
    const heights = ['A', 'B', 'C'].map((text) => {
      const row = page.getByText(text).element().parentElement
      return row ? getComputedStyle(row).minHeight : ''
    })
    expect(heights).toEqual(['32px', '44px', '56px'])
  })
})

describe('ListRow title, subtitle and action', () => {
  it('is two-line (56px) with a subtitle, and styles the title 13/500 and the subtitle 12 tertiary', async () => {
    await render(
      <ListRow
        href="/a"
        title="checkout/payment"
        subtitle="Build #12"
        trailing={<span>2d</span>}
      />,
    )
    const row = page.getByRole('link')
    expect(getComputedStyle(row.element()).minHeight).toBe('56px')
    const title = getComputedStyle(page.getByText('checkout/payment').element())
    expect(title.fontSize).toBe('13px')
    expect(title.fontWeight).toBe('500')
    const subtitle = getComputedStyle(page.getByText('Build #12').element())
    expect(subtitle.fontSize).toBe('12px')
    await expect.element(row).toHaveTextContent('checkout/paymentBuild #122d')
  })

  it('cuts a long title with an ellipsis instead of growing the row', async () => {
    await render(
      <div style={{ width: 240 }}>
        <ListRow href="/a" title={'long '.repeat(40)} subtitle={'sub '.repeat(40)} />
      </div>,
    )
    const title = page.getByText(/^long/).element()
    expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
    expect(title.scrollWidth).toBeGreaterThan(title.clientWidth)
    expect(page.getByRole('link').element().getBoundingClientRect().height).toBeLessThan(80)
  })

  it('shows the action chip on hover and selection only, and runs it without activating the row', async () => {
    const onClick = vi.fn<(event: MouseEvent<HTMLElement>) => void>()
    const onAction = vi.fn<() => void>()
    await render(
      <>
        <ListRow onClick={onClick} title="Hovered" action={{ label: 'Open ↗', onAction }} />
        <ListRow selected onClick={onClick} title="Chosen" action={{ label: 'Go ↗', onAction }} />
      </>,
    )
    const hidden = page.getByText('Open ↗').element()
    expect(getComputedStyle(hidden).display).toBe('none')
    expect(getComputedStyle(page.getByText('Go ↗').element()).display).not.toBe('none')
    await page.getByRole('button', { name: /Hovered/ }).hover()
    expect(getComputedStyle(hidden).display).not.toBe('none')
    await page.getByText('Open ↗').click()
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('paints the hover wash on an interactive row', async () => {
    await render(<ListRow href="/a" title="Row" />)
    const row = page.getByRole('link')
    await row.hover()
    const probe = document.createElement('span')
    probe.style.background = 'var(--circi-action-hover)'
    document.body.append(probe)
    expect(getComputedStyle(row.element()).backgroundColor).toBe(
      getComputedStyle(probe).backgroundColor,
    )
    probe.remove()
  })
})

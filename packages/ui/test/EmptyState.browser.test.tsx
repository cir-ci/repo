import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import {
  Button,
  CommandBlock,
  EmptyState,
  NoFilterResults,
  NoResults,
  PanePlaceholder,
  SearchIcon,
} from '#src/index.ts'

import { stubClipboard } from './support/clipboard.ts'

describe('EmptyState', () => {
  it('shows a heading, a line of text and an action', async () => {
    await render(
      <EmptyState title="No projects yet" action={<Button variant="primary">New project</Button>}>
        Create one to start comparing builds.
      </EmptyState>,
    )
    await expect
      .element(page.getByRole('heading', { name: 'No projects yet', level: 2 }))
      .toBeVisible()
    await expect.element(page.getByText('Create one to start comparing builds.')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'New project' })).toBeVisible()
  })

  it('takes the heading level of the page and hides its icon', async () => {
    const { container } = await render(<EmptyState title="Oops" headingLevel={1} tone="failed" />)
    await expect.element(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
    expect(container.querySelector('[data-tone="failed"]')).not.toBeNull()
  })

  it('takes paragraphs and blocks in its description without nesting them in a <p>', async () => {
    const { container } = await render(
      <EmptyState title="Couldn't read it">
        <p>The file is not a PNG.</p>
        <div>Technical details</div>
      </EmptyState>,
    )
    await expect.element(page.getByText('The file is not a PNG.')).toBeVisible()
    expect(container.querySelector('p p, p div')).toBeNull()
  })

  it('renders without description or action', async () => {
    await render(<EmptyState title="Nothing here" />)
    await expect.element(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible()
    await expect.element(page.getByRole('button')).not.toBeInTheDocument()
  })

  it('draws any icon at 32px with a 1.5 stroke', async () => {
    const { container } = await render(<EmptyState icon={<SearchIcon size={16} />} title="x" />)
    const svg = container.querySelector('svg')!
    const box = svg.getBoundingClientRect()
    expect([box.width, box.height]).toEqual([32, 32])
    expect(getComputedStyle(svg).strokeWidth).toBe('1.5px')
  })

  it('uses the approved glyph for the success tone, hidden from assistive tech', async () => {
    const { container } = await render(<EmptyState tone="success" title="You're all caught up" />)
    const glyph = container.querySelector('svg[data-status="approved"]')!
    expect(glyph).not.toBeNull()
    expect(glyph.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(glyph.getBoundingClientRect().width).toBe(32)
    await expect.element(page.getByRole('img')).not.toBeInTheDocument()
  })

  it('has a 15/600 title and a body at most 360px wide', async () => {
    await render(
      <div style={{ width: 800 }}>
        <EmptyState title="Title">
          {'A long sentence that goes on and on to make sure it wraps well before it is wide. '.repeat(
            3,
          )}
        </EmptyState>
      </div>,
    )
    const title = getComputedStyle(page.getByRole('heading').element())
    expect([title.fontSize, title.fontWeight]).toEqual(['15px', '600'])
    const body = page.getByText(/A long sentence/).element()
    expect(body.getBoundingClientRect().width).toBeLessThanOrEqual(360)
  })

  it('centres the page size in its container and pads the section size less', async () => {
    const { container } = await render(
      <div style={{ display: 'flex', flexDirection: 'column', width: 600, height: 500 }}>
        <EmptyState title="Centred" />
      </div>,
    )
    const outer = container.firstElementChild!.getBoundingClientRect()
    const heading = page.getByRole('heading').element().getBoundingClientRect()
    expect(
      Math.abs(heading.left + heading.width / 2 - (outer.left + outer.width / 2)),
    ).toBeLessThan(1)
    expect(
      Math.abs(heading.top + heading.height / 2 - (outer.top + outer.height / 2)),
    ).toBeLessThan(40)
    const section = await render(<EmptyState size="section" title="In a card" />)
    await expect
      .poll(() => getComputedStyle(section.container.firstElementChild!).paddingTop)
      .toBe('32px')
  })
})

describe('NoResults', () => {
  it('says what was not found and clears the search', async () => {
    const onClear = vi.fn<() => void>()
    await render(<NoResults noun="baseline" query="footer" onClear={onClear} />)
    await expect
      .element(page.getByRole('heading', { name: 'No baseline matches “footer”' }))
      .toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Clear search' }))
    await expect.poll(() => onClear).toHaveBeenCalledOnce()
  })

  it('cuts a long query at 24 characters', async () => {
    await render(
      <NoResults noun="project" query="a very long search that goes on" onClear={() => {}} />,
    )
    await expect
      .element(page.getByRole('heading', { name: 'No project matches “a very long search that…”' }))
      .toBeVisible()
  })
})

describe('NoFilterResults', () => {
  it('names the scope and clears the filters', async () => {
    const onClear = vi.fn<() => void>()
    await render(<NoFilterResults plural="builds" scope="web-app" onClear={onClear} />)
    await expect.element(page.getByRole('heading', { name: 'No builds match' })).toBeVisible()
    await expect.element(page.getByText('Nothing in web-app fits these filters.')).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Clear filters' }))
    await expect.poll(() => onClear).toHaveBeenCalledOnce()
  })
})

describe('PanePlaceholder', () => {
  it('is a hidden icon and one line, without a heading', async () => {
    const { container } = await render(<PanePlaceholder>Select a notification</PanePlaceholder>)
    await expect.element(page.getByText('Select a notification')).toBeVisible()
    await expect.element(page.getByRole('heading')).not.toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
  })
})

describe('CommandBlock', () => {
  it('wraps a long command in mono 12 and copies it', async () => {
    const writeText = stubClipboard()
    const command =
      'CIRCI_TOKEN=… CIRCI_API_URL=https://ci.example.com \\\n  npx circi upload ./screenshots --wait'
    await render(
      <div style={{ width: 800 }}>
        <CommandBlock command={command} />
      </div>,
    )
    await expect.element(page.getByText(/CIRCI_TOKEN/)).toBeVisible()
    const code = page.getByText(/CIRCI_TOKEN/).element()
    // The stylesheet may land a moment after the first paint on a busy machine.
    await expect
      .poll(() => {
        const style = getComputedStyle(code)
        return [style.fontSize, style.whiteSpace, style.overflowWrap]
      })
      .toEqual(['12px', 'pre-wrap', 'anywhere'])
    await expect
      .poll(() => code.parentElement!.getBoundingClientRect().width)
      .toBeLessThanOrEqual(360)
    await userEvent.click(page.getByRole('button', { name: 'Copy command' }))
    await expect.poll(() => writeText).toHaveBeenCalledWith(command)
    await expect
      .element(page.getByRole('button', { name: 'Copy command' }))
      .toHaveTextContent('Copied')
  })
})

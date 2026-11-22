import { describe, expect, it } from 'vitest'

import { declarationsOf } from './support/css-rules.ts'

/**
 * Layout facts that belong to one component's own stylesheet rule and depend on nothing else (no
 * cascade across files, no tokens, no measured size), read from the CSS instead of from a page.
 * What needs a real layout (scrolling, truncation, drawers opening) stays in the browser tests.
 */
const STACK = 'packages/ui/src/Stack.module.css'

describe('Stack', () => {
  it('is a column flex container that can shrink, and a row when told', () => {
    const root = declarationsOf(STACK, '.root')
    expect(root.get('display')).toBe('flex')
    expect(root.get('flex-direction')).toBe('column')
    expect(root.get('min-width')).toBe('0')
    expect(declarationsOf(STACK, ".root[data-direction='row']").get('flex-direction')).toBe('row')
  })

  it('maps its gap steps to 4px multiples, and its alignment and wrapping to flexbox', () => {
    const gaps = [
      ['1', '4px'],
      ['2', '8px'],
      ['3', '12px'],
      ['4', '16px'],
      ['5', '20px'],
      ['6', '24px'],
      ['8', '32px'],
    ]
    expect(
      gaps.map(([step]) => declarationsOf(STACK, `.root[data-gap='${step}']`).get('gap')),
    ).toEqual(gaps.map(([, size]) => size))
    expect(declarationsOf(STACK, ".root[data-align='center']").get('align-items')).toBe('center')
    expect(declarationsOf(STACK, ".root[data-justify='between']").get('justify-content')).toBe(
      'space-between',
    )
    expect(declarationsOf(STACK, '.root[data-wrap]').get('flex-wrap')).toBe('wrap')
  })
})

describe('Drawer', () => {
  it("never scrolls its own popup: the content's ScrollArea does", () => {
    expect(declarationsOf('packages/ui/src/Drawer.module.css', '.popup').get('overflow')).toBe(
      'hidden',
    )
  })
})

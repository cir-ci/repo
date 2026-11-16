import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { visuallyHidden } from '#src/theme.ts'

/** The declarations of the `.visuallyHidden` rule in utilities.module.css, by property. */
function cssRule(): Record<string, string> {
  const css = readFileSync(new URL('../src/utilities.module.css', import.meta.url), 'utf8')
  const body = /\.visuallyHidden\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  const rule: Record<string, string> = {}
  for (const [, name, value] of body.matchAll(/^\s*([a-z-]+):\s*(.+);$/gm)) {
    if (name && value) rule[name] = value
  }
  return rule
}

it('the CSS .visuallyHidden and the JS visuallyHidden pin the box to the same corner', () => {
  const rule = cssRule()
  expect(rule['top']).toBe(`${visuallyHidden.top}`)
  expect(rule['left']).toBe(`${visuallyHidden.left}`)
  expect(rule['position']).toBe(visuallyHidden.position)
  expect(rule['margin']).toBe(`${visuallyHidden.margin}px`)
})

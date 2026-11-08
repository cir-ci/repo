// The fonts the dashboard loads: the screenshots must not fall back to a system font.
// oxlint-disable-next-line import/no-unassigned-import
import '@fontsource-variable/inter'
// oxlint-disable-next-line import/no-unassigned-import
import '@fontsource-variable/jetbrains-mono'
import { circiScreenshot } from '@circi/vitest/browser'
import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { CirciTheme, COLOR_SCHEME_ATTRIBUTE } from '#src/index.ts'

import { extraCases } from './cases.tsx'

/**
 * CirCI tests its own design system: every `@circi/ui` component, in both colour schemes, is
 * screenshotted with `@circi/vitest` (run with `pnpm test:visual`, see docs/vitest.md).
 *
 * The cases are the design-sync previews (`.design-sync/previews/*.tsx`, one file per component)
 * plus `./cases.tsx` for the components without a preview. A preview that pins its own schemes
 * (it shows `data-circi-color-scheme` subtrees side by side) is shot once per pinned subtree;
 * any other is rendered inside `CirciTheme` once per scheme. A preview that renders into a portal
 * (dialogs, drawers) has no size of its own, so the whole page is shot.
 */

const SCHEMES = ['light', 'dark'] as const

const previewModules = import.meta.glob<Record<string, unknown>>(
  '../../../.design-sync/previews/*.tsx',
  { eager: true },
)

const isComponent = (value: unknown): value is ComponentType => typeof value === 'function'

const files = new Map<string, Record<string, unknown>>([
  ...Object.entries(previewModules).map(
    ([path, mod]) => [path.slice(path.lastIndexOf('/') + 1).replace(/\.tsx$/, ''), mod] as const,
  ),
  ...Object.entries(extraCases),
])

const kebab = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/^-+/, '')

for (const [component, exports] of files) {
  // oxlint-disable-next-line vitest/valid-title -- generated: one suite per component
  describe(component, () => {
    for (const [exportName, Case] of Object.entries(exports)) {
      if (!isComponent(Case)) continue
      const base = `${component}/${kebab(exportName)}`

      // oxlint-disable-next-line vitest/valid-title -- generated: one test per case
      it(exportName, async () => {
        const saved: string[] = []

        // Pinned schemes inside the preview? Then one shot per pinned subtree.
        const probe = await render(
          <CirciTheme mode="dark">
            <Case />
          </CirciTheme>,
        )
        const pinned = [...probe.container.querySelectorAll(`[${COLOR_SCHEME_ATTRIBUTE}]`)]
        for (const el of pinned) {
          const scheme = el.getAttribute(COLOR_SCHEME_ATTRIBUTE) ?? 'unknown'
          // oxlint-disable-next-line no-await-in-loop -- shots are taken one at a time
          saved.push(await circiScreenshot(page.elementLocator(el), `${base}/${scheme}`))
        }
        await probe.unmount()

        if (pinned.length === 0) {
          for (const scheme of SCHEMES) {
            // oxlint-disable-next-line no-await-in-loop -- one render at a time
            const view = await render(
              <CirciTheme mode={scheme}>
                <Case />
              </CirciTheme>,
            )
            // No size of its own: a portal (dialog, drawer). Shoot the page.
            const sized = view.container.getBoundingClientRect().height > 0
            const target = sized ? page.elementLocator(view.container) : page
            // oxlint-disable-next-line no-await-in-loop -- ditto
            saved.push(await circiScreenshot(target, `${base}/${scheme}`))
            // oxlint-disable-next-line no-await-in-loop -- ditto
            await view.unmount()
          }
        }

        expect(saved.length).toBeGreaterThan(0)
      })
    }
  })
}

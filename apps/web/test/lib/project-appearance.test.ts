import { PROJECT_COLORS, PROJECT_ICON_NAMES } from '@circi/core'
// The design system's own file, not the package index (which pulls in CSS modules): `@circi/ui`
// cannot import `@circi/core` (it is built for the browser), and core cannot import lucide, so
// core keeps a generated copy of lucide-react's icon names (`pnpm icons:generate`).
import { LUCIDE_ICON_NAMES as LUCIDE_ICONS } from '@circi/ui/lucide-names'
import { PROJECT_COLORS as UI_COLORS } from '@circi/ui/project-icons'
import { describe, expect, it } from 'vitest'

describe('project appearance lists', () => {
  it('the server accepts exactly the installed lucide-react icons and the palette the design system draws', () => {
    expect(
      [...LUCIDE_ICONS].toSorted(),
      'lucide-react changed: run `pnpm icons:generate` and `pnpm format`',
    ).toEqual([...PROJECT_ICON_NAMES])
    expect([...UI_COLORS]).toEqual([...PROJECT_COLORS])
  })
})

import { TEAM_COLORS, TEAM_ICON_NAMES } from '@circi/core'
// The design system's own file, not the package index (which pulls in CSS modules): `@circi/ui`
// cannot import `@circi/core` (it is built for the browser), and core cannot import lucide, so
// core keeps a generated copy of lucide-react's icon names (`pnpm icons:generate`).
import { TEAM_COLORS as UI_COLORS, TEAM_ICON_NAMES as LUCIDE_ICONS } from '@circi/ui/team-icons'
import { describe, expect, it } from 'vitest'

describe('team appearance lists', () => {
  it('the server accepts exactly the installed lucide-react icons and the palette the design system draws', () => {
    expect(
      [...LUCIDE_ICONS].toSorted(),
      'lucide-react changed: run `pnpm icons:generate` and `pnpm format`',
    ).toEqual([...TEAM_ICON_NAMES])
    expect([...UI_COLORS]).toEqual([...TEAM_COLORS])
  })
})

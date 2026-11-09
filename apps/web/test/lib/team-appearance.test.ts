import { TEAM_COLORS, TEAM_ICON_NAMES } from '@circi/core'
// The design system's own file, not the package index (which pulls in CSS modules): `@circi/ui`
// cannot import `@circi/core` (it is built for the browser) so it keeps a copy of both lists.
import {
  TEAM_COLORS as UI_COLORS,
  TEAM_ICON_NAMES as UI_ICONS,
  TEAM_ICONS,
} from '@circi/ui/team-icons'
import { describe, expect, it } from 'vitest'

describe('team appearance lists', () => {
  it('the design system draws exactly the icons and colours the server accepts', () => {
    expect([...UI_ICONS]).toEqual([...TEAM_ICON_NAMES])
    expect([...UI_COLORS]).toEqual([...TEAM_COLORS])
    expect(Object.keys(TEAM_ICONS).toSorted()).toEqual([...TEAM_ICON_NAMES].toSorted())
  })
})

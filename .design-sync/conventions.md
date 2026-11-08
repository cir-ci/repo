# CirCI design system

CirCI is a self-hosted visual-regression dashboard. The look is dense and quiet: the screenshots under review are the loudest thing on screen, and everything else steps back. There is a light and a dark scheme; dark is the default and the reference look.

## Setup (required)

Wrap every screen in `CirciTheme`. It owns the colour scheme (it sets `data-circi-color-scheme` on `<html>`, which picks the colour tokens and `color-scheme`); the page ground and font come with the package's stylesheet. It follows the system scheme; `<CirciTheme mode="light">` pins one. To show one area in the other scheme, put `data-circi-color-scheme="light"` (or `"dark"`) on its wrapper. `ColorSchemeControl` is the viewer's System / Light / Dark switch.

```jsx
const { CirciTheme, AppFrame, NavItem, PanelHeader, ListRow, StatusIcon, StatusChip, tokens } = window.CirciUI

<CirciTheme>
  <AppFrame
    sidebar={<>
      <NavItem href="#" selected>Teams</NavItem>
      <NavItem href="#">Members</NavItem>
    </>}
  >
    <PanelHeader actions={<StatusChip status="needs-review" />}>web-app / Build #148</PanelHeader>
    <ListRow leading={<StatusIcon status="approved" />} trailing={<span>2m</span>}>Add payment form validation</ListRow>
  </AppFrame>
</CirciTheme>
```

## Styling idiom

There are no CSS classes to use: components are styled in JS. Build your own layout glue with inline styles and the values in `tokens` (a plain object on `window.CirciUI`). Every token is a CSS variable (`var(--circi-surface-panel)`), so the same style works in both schemes; never copy hex values. `palettes.light` / `palettes.dark` hold the raw colours for the rare place a variable can't go:

- Surfaces, dimmest to highest: `tokens.surface.chrome` (sidebar and page ground), `panel` (content), `raised` (inputs, buttons), `overlay` (menus), `highest`.
- Text: `tokens.text.primary`, `secondary`, `tertiary`.
- Accent: `tokens.accent.main` (the logo-derived clay), `tokens.accent.text` for accent-coloured text, `tokens.accent.onAccent` for text on an accent fill, `tokens.accent.subtle` behind a selected row.
- State: `tokens.state.approved` (teal), `review` (amber), `processing` (periwinkle), `rejected` (crimson). Pending added, removed and flaky have their own glyphs (ring with plus, minus, tilde; amber). `reviewText` is the amber for words (darker in light). Use them only for state, never decoration.
- Lines: `tokens.line.subtle` for dividers, `strong` for control edges. Use hairlines, not shadows.
- Team identity: `TeamTile` (16, 20, 24 or 40px) is a rounded square in one of the team colours (`slate`, `olive`, `plum`, `moss`, `mauve`, `graphite`: `tokens.team.*`) holding the team's first letter or a Lucide icon in `var(--circi-tile-text)`. It tells teams apart and never means a state: do not use `state.*` colours for a team, and pick the colour by the team, not by its health. Write the team's name beside it (the tile is then decorative); `labelled` makes it an image named by the team.
- Badge text colours: a `Badge` is neutral (`text.primary`), accent (`accent.text`) or state (`tone="state"` with `state` naming one). A state badge has a 14% tint of the state colour behind it and its words use the state's *text* colour (`approved-text`, `review-text`, `rejected-text`; processing uses its glyph colour), which is darker than the glyph in light so it reads as words. Always `count` (pill, numbers) or `tag` (radius 4, words); never colour a badge by hand.
- Brand: `tokens.brand.maroon`, `blush`, `rosewood`, `salmon`, `terracotta` (the logo's tones).
- Fonts: Inter at 13px for UI; `window.CirciUI.monoFont` for branch names, commit SHAs and anything copyable.

State is always shown with `StatusIcon` or `StatusChip` (shape plus colour), with these `status` values: `approved`, `needs-review`, `processing`, `rejected`, `neutral` (labelled "Unchanged"), plus the per-diff glyphs `added`, `removed`, `flaky`.

## Layout

`AppFrame` puts a dim sidebar beside one lifted content panel; the panel starts with `PanelHeader` (44px: breadcrumb left, actions right). The current breadcrumb is the page's `<h1>` (`Breadcrumbs currentIsHeading`); a page with no breadcrumb has a visually hidden `<h1>`. Words: Team and Workspace, never project or organisation. Lists are `ListRow`s (44px, hairline between). Switch views of one thing with `SegmentedControl`; show shortcut hints with `Kbd`. Dense, left-aligned, no cards-in-cards.

## Where to look

Read `styles.css` for the font faces and each component's `.d.ts` for props before building. The source of truth for colours is `tokens`, not hex values copied from screenshots.

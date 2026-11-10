# Design gaps: what `@circi/ui` still needs designed

Status: 2026-11-09. The provisional designs below are built, and the canvas
(https://claude.ai/artifact/WiAjMhRumRaiSMaYTeNc39) has since settled most of them: see
"Settled by the canvas" below. The design system (`.design-sync/conventions.md`) covers the frame, rows,
status glyphs, segmented control and key caps. Everything below is used by the dashboard but not
designed yet.

Each gap has a **provisional spec** derived from the existing conventions (dense, quiet, hairlines
not shadows, 13px Inter, 28px controls, 44px rows, tokens only). Components get built to it now
(decision in `docs/plans/archive/base-ui-plan.md`) and are marked `Provisional` in their doc comment until a
designer signs them off. **Needs a decision** lists what the spec can't settle by itself.

Sizes in px. Colours are token names (`surface.raised` = `var(--circi-surface-raised)`).

## Settled by the canvas (2026-11-09)

The canvas's Foundations, Components and Screens boards answered these; the spec in each section
below is kept as history and is superseded where it disagrees.

- **Settled:** focus ring (2px `accent.text`, 2px out, never removed; inset on rows), radii (4, 6,
  8, 10, 12 only), control height 28 and input height 32, nothing interactive under 24px, no type
  under 11px, row densities (32 / 44 / 56), selected row (`accent.subtle` and a 2px bar),
  the light scheme (the `MainLight` board; `canvas-palette.json` pins it), flaky as amber with its
  own tilde glyph, and the status glyph shapes (§8).
- **Settled, new components:** `Badge` (count or tag; neutral, accent or state), `Switch`
  (instant-apply settings only), `Pane` (preview pane), `TeamTile` (identity in a team colour with
  `tile-text` on top, never state), `NavSection`, the settings navigation, the Add integration
  dialog, `PageHeading`'s rule (the current breadcrumb is the page's `<h1>`).
- **Settled, copy:** the words are Team and Workspace (never project or organisation).
- **Still open:** logo and favicon (§15), a human sign-off of components (§16), the 5px row inset on
  `NavItem`, group headers at 32px, and motion (120ms ease-out is provisional).

## 1. Buttons

**Provisional:** height 28 (`size="small"` 24), padding-inline 10, radius 6, 12px/500.
- `primary`: fill `accent.main`, text `accent.onAccent`; hover 8% lighter (dark) / darker (light).
- `secondary` (default): fill `surface.raised`, 1px `line.strong`, text `text.primary`; hover
  `surface.overlay`.
- `danger`: like secondary, text `state.rejected`; the confirming button inside a `ConfirmDialog`
  is filled `state.rejected`.
- `ghost`: no fill or border, text `text.secondary`; hover `action.hover`.
- `IconButton`: 28×28 square, ghost style, 16px icon, always has an accessible name.
- Loading: label stays, a 12px `Spinner` replaces the leading icon, button disabled.
- Disabled: 45% opacity, no hover.

**Needs a decision:** is `primary` allowed more than once per screen? Do buttons carry `Kbd`
hints (Approve `a`)?

## 2. Form fields

**Provisional:** label above the control (12px/500, `text.secondary`, 6 gap), control 32 high,
fill `surface.raised`, 1px `line.strong`, radius 6, 13px text; description under it (12px,
`text.tertiary`); error replaces the description (12px, `state.rejected`) and the edge turns
`state.rejected`. `Select` matches the text field with a chevron; its popup is a `Menu` (§4).
Checkbox 14×14, radius 3, checked fill `accent.main`. Switch only if a setting applies instantly.

Settings pages: one column, max width 640, sections separated by a hairline and a `SectionHeader`
(13px/600 + one line of `text.secondary` description), 24 between fields.

**Needs a decision:** stacked labels everywhere, or a label column on wide settings pages? Save
per section or per page? Instant-apply switches vs explicit Save?

## 3. Feedback

**Provisional:**
- `Banner` (replaces `Alert`): full width at the top of the panel or section, 1px border in the
  state colour at 40%, fill the state colour at 8%, `StatusIcon`-style glyph, text
  `text.primary`, optional action button on the right. Tones: `info` (processing), `success`
  (approved), `warning` (review), `danger` (rejected). `role="alert"` only for errors.
- Inline field errors: §2.
- Toasts: **none**. Results show where the action happened (row updates, banner); screen readers
  get the existing announcer.
- Destructive actions (delete team, webhook, member, revoke token): `ConfirmDialog` naming the
  thing; deleting a team requires typing its slug.

**Needs a decision:** really no toasts? Invitation and address-change banners: in the panel, or
above the whole frame?

## 4. Overlays

**Provisional:**
- `Dialog`: width 440 (forms) / 560 (wide), fill `surface.overlay`, 1px `line.strong`, radius 10,
  backdrop black at 50% (dark) / 30% (light). Header 44 with title (15px/600) and close
  `IconButton`; footer right-aligned buttons, primary last.
- `Menu`: fill `surface.overlay`, 1px `line.strong`, radius 8, padding 4, items 28 high, radius 5,
  hover `action.hover`, optional `Kbd` on the right, separators as hairlines.
- `Tooltip`: fill `surface.highest`, 12px, radius 5, 6×8 padding, 500ms delay; only for icon
  buttons and truncated text.
- The only shadow allowed: popups get a soft shadow in light mode, where hairlines alone don't
  separate white on white.

**Needs a decision:** is the light-mode popup shadow acceptable, given "hairlines, not shadows"?

## 5. Empty, loading and error states

**Provisional:**
- `EmptyState`: centred in the panel, 32px Lucide icon in `text.tertiary`, title 15px/600, one
  line of `text.secondary`, one optional primary action. For "no teams", "no builds", "no
  sites", "no members besides you".
- Loading: `ListSkeleton` (rows of 44 with two shimmer bars at `surface.raised`), shown only after
  300ms (`Delayed`) so fast loads don't flash. `Spinner` (12/16, `text.tertiary`) inside buttons
  and for background refresh.
- Error: an `EmptyState` with the `rejected` tone, the page's own words ("This build doesn't
  exist"), and a retry button for 5xx/network errors.
- 404 page: the error state inside the frame, with a link back to Teams.

**Needs a decision:** illustrations, or icons only?

## 6. Sidebar

**Provisional (top to bottom):** workspace switcher (24px workspace avatar + name + chevron, opens a `Menu`
listing workspaces and "New workspace"); main `NavItem`s: Teams, Members, Settings; a "Teams"
group listing the workspace's teams (alphabetical, max 10, then "All teams"); bottom: user menu
(avatar + name; menu holds Account, Theme (`ColorSchemeControl`), Sign out) and the CirCI version.

Inside a team: the team's items appear under its name in the group: Builds, Sites,
Settings.

Under 820px: a 44px top bar with the logo, current page and a menu button that opens the sidebar
as a `Drawer` (Base UI `drawer`). Today the frame stacks the whole sidebar above the panel, which
pushes content below the fold on phones.

**Built, with deviations (2026-11-08):** the workspace list is derived from the teams and capabilities
the viewer has, because there is no workspace-list endpoint (a workspace with no teams that the viewer
can't manage is missing); the switcher has no "New workspace" item (no API or flow); no CirCI
version in the footer (the web app has no version source); inside a team the team name
itself is the Builds entry; the sidebar lists at most 10 teams alphabetically
(`SIDEBAR_TEAM_LIMIT`); the mobile top bar and `Drawer` are built.

**Needs a decision:** recent vs alphabetical vs pinned teams; whether the workspace switcher shows
when there is only one workspace; the drawer on mobile.

## 7. Build review screen

The main screen, and the least designed. **Provisional:**
- `PanelHeader`: breadcrumb `team / Build #148`, branch `Ref`, then on the right `StatusChip`,
  Reject (`danger`), Approve all (`primary`), each with its `Kbd` hint in a tooltip.
- Below it, two columns: the screenshot list (280 wide, its own scroll) and the viewer.
- List: groups Changed / Added / Removed / Flaky / Failed / Unchanged (collapsed, with a count),
  each row 36 high: `StatusIcon`-like glyph, name (truncated, full name in a tooltip), diff % on
  the right in mono.
- Viewer toolbar (36 high): `SegmentedControl` Side by side / Overlay / Diff / Slider, zoom
  (fit, 100%, +/−), ignore-region toggle, prev/next with `Kbd` j/k.
- Viewer ground: a checkerboard so transparent pixels show; images never scaled up past 100% at
  "fit".
- `?` opens a shortcut help dialog.

**Built, with deviations (2026-11-08):** the page has the list and viewer, the four modes
(side by side, overlay, diff, slider), fit/zoom, j/k, `a`/`r` (reject and "sign out everywhere"
ask for confirmation) and the `?` shortcut dialog. Dropped or not built: the ignore-region toggle
(the build API sends no region data), list thumbnails, the narrow-screen "All screenshots" link,
per-screenshot approve, a resizable list, synced zoom/pan; the list's Flaky group is set aside
from the others.

**Needs a decision:** list width resizable? Per-screenshot approve, or only whole builds (PLAN.md
has per-screenshot comments as a later feature)? What a reviewer sees after approving (next
build, stay)?

## 8. Status mapping

The design has five statuses (`approved`, `needs-review`, `processing`, `rejected`, `neutral`).
**Provisional mapping**, the glyph's label carries the precise word:

| Thing | State | Status | Label |
| --- | --- | --- | --- |
| Build | uploading, pending | processing | Uploading |
| Build | processing | processing | Processing |
| Build | complete, changes, review pending | needs-review | Needs review |
| Build | approved / auto-approved | approved | Approved |
| Build | rejected | rejected | Rejected |
| Build | no changes | approved | No changes |
| Build | error | failed | Failed |
| Build | expired | neutral | Expired |
| Build | orphan (no baseline) | neutral | No baseline |
| Screenshot | changed | needs-review | Changed |
| Screenshot | added | needs-review | Added |
| Screenshot | removed | needs-review | Removed |
| Screenshot | unchanged | neutral | Unchanged |
| Screenshot | flaky | neutral | Flaky |
| Screenshot | failed (couldn't compare) | failed | Failed |

**Built (2026-11-08):** after a build is approved or rejected the per-screenshot glyphs show the
review (`screenshotStatus(kind, review)`); unchanged and flaky stay neutral, failed stays
failed (a crimson cross; `rejected` is the rose, barred glyph for a decision). The table above is the state before a review.

**Needs a decision:** do added/removed/flaky need their own glyphs (e.g. +, −, ~) rather than
sharing `needs-review`/`neutral`? That would mean extending `StatusIcon`, and the "state colour
only for state" rule still holds.

## 9. Tables vs rows

**Provisional:** everything is `ListRow`s, no tables. Members: avatar, name + email, role
`Select` on the right, row `Menu` (remove). Webhooks: URL in mono, events as small chips, last
delivery status glyph, row menu. Sites: kind icon, name, commit/branch `Ref`, open link. CI token:
a single row with the masked token, Copy and Regenerate.

**Needs a decision:** is there any list that needs sortable columns (members on large workspaces)?

## 10. Screens outside the frame

**Provisional:** Login, first-run Setup and Site sign-in handoff use one layout: `surface.chrome`
ground, logo at the top centre, a 400-wide `surface.panel` box with 1px `line.subtle`, radius 10,
padding 24; title 20/600, one line of `text.secondary`, then the form. Footer: CirCI version.

**Needs a decision:** the Setup wizard: one page or steps?

## 11. Typography scale

**Provisional (Inter):** `display` 20/600 (login and setup titles only), `title` 15/600 (dialog
and empty-state titles), `heading` 13/600 (section headings), `body` 13/400, `small` 12/400
(meta, descriptions), `micro` 11/500 (counts, `Kbd`). `mono` (JetBrains Mono) 12 for SHAs,
branches, tokens, diff %. Page titles live in the `PanelHeader` at 13/500: there is no big page
title inside the frame.

## 12. Icons (Lucide)

**Decided:** Lucide (`lucide-react`), re-exported from `@circi/ui` (only the icons used), so the
app never imports it directly. **Provisional:** 16px in rows, nav and buttons, 14px inside chips,
stroke 1.75, colour inherits (`text.secondary` by default). Status is never an icon from Lucide:
it's always `StatusIcon`.

## 13. Interaction states

**Provisional:** hover `action.hover`; selected `action.selected` (nav) or `accent.subtle` + 2px
`accent.main` inset bar (rows); focus ring 2px `accent.text` outside the element with 2px offset (inset 5px on rows),
only on keyboard focus (`:focus-visible`); disabled 45% opacity. Motion: 120ms ease-out for
popups and hover; none for layout; nothing moves when `prefers-reduced-motion`.

## 14. The light scheme

Built (refactor-plan §4.0). Since 2026-11-08 the light palette is the canvas's (`MainLight` board;
`packages/ui/test/canvas-palette.json` fails a test if `theme.ts` drifts from it); the earlier
"derived, not designed" values are gone. **Settled by the canvas:** chrome-vs-panel separation
(`#f3efed` vs `#fcfbfa`) and the accent clay. **Still open:** the light review amber is 2.7:1 on
chrome (next-steps-plan R11).

## 15. Logo and favicon

**Needed:** the logo as SVG in a version for each scheme (the maroon `#724039` disappears on the
dark chrome), a 32px mark for the sidebar and a favicon. Nothing provisional: the frame shows the
word "CirCI" in 13/600 until then.

## 16. Sign-off

design-sync grades so far were by eye, by Claude, with no human review in `.review.html`. **Needs
a decision:** who signs off components, and does a component's `Provisional` mark block the page
that uses it from shipping?

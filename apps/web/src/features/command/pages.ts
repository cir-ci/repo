import type { Sidebar } from '@circi/api'
import type { ColorMode } from '@circi/ui'

import { switchWorkspacePath, type WorkspaceRef } from '#app/shell-model.ts'

import type { Entry, IconKey, PageId, RowAction, Subject } from './entry.ts'
import { matchScore, THEME_CHOICES, wordsOf } from './model.ts'

/**
 * The nested lists a row with a chevron opens (Switch team…, Switch workspace…, Theme…) and the
 * actions of one highlighted row (⌘.). A nested list replaces the main one: the field shows a chip
 * with its name and a new placeholder, rows show the current choice with a check, and Backspace in
 * the empty field or Esc goes back.
 */

export interface PageState {
  page: PageId
  /** The row whose actions are listed (page `row`). */
  entry?: Entry
}

export const PAGE_META: Record<
  PageId,
  { chip: string; placeholder: string; noun: [string, string] }
> = {
  team: { chip: 'Switch team', placeholder: 'Find a team', noun: ['team', 'teams'] },
  workspace: {
    chip: 'Switch workspace',
    placeholder: 'Find a workspace',
    noun: ['workspace', 'workspaces'],
  },
  theme: { chip: 'Theme', placeholder: 'Choose a theme', noun: ['theme', 'themes'] },
  row: { chip: 'Actions', placeholder: 'Find an action', noun: ['action', 'actions'] },
}

export interface PageInput {
  workspace: string | undefined
  pathname: string
  teams: readonly Sidebar.Team[] | undefined
  workspaces: readonly WorkspaceRef[]
  /** The team of the address, which is the current choice of Switch team. */
  routeTeam: string | undefined
  theme: ColorMode
}

const enc = encodeURIComponent

/** Where choosing `slug` goes: the same section of that team (Triage stays Triage), else its builds. */
export function switchTeamPath(pathname: string, workspace: string, slug: string): string {
  const parts = pathname.split('/').filter(Boolean)
  const base = `/${enc(workspace)}/${enc(slug)}`
  const onTeam =
    parts.length >= 3 && !['workspaces', 'account', 'instance', 'inbox'].includes(parts[0] ?? '')
  const section = onTeam ? parts[2] : undefined
  if (section === 'triage' || section === 'baselines' || section === 'sites') {
    return `${base}/${section}`
  }
  return base
}

/** Where choosing a workspace goes, as the workspace switcher decides it. */
export function switchWorkspaceTarget(
  pathname: string,
  slug: string,
  teamOf: (workspace: string) => string | undefined,
): string | undefined {
  return switchWorkspacePath(pathname, slug, teamOf)
}

const choice = (
  id: string,
  label: string,
  current: boolean,
  target: Entry.Target,
  icon: IconKey,
  line: string,
  extra: Partial<Entry> = {},
): Entry => ({
  id,
  group: '',
  kind: 'choice',
  label,
  ...(current ? { detail: 'Current', checked: true } : {}),
  icon,
  target,
  peek: { kind: 'Choice', title: label, lines: [line], rows: [] },
  ...extra,
})

/** The rows of a nested list, filtered by what is typed in its field. */
export function pageEntries(state: PageState, input: PageInput, query: string): Entry[] {
  const words = wordsOf(query)
  const keep = (e: Entry) => words.length === 0 || matchScore(e, words) > 0
  if (state.page === 'team') {
    if (!input.workspace) return []
    const workspace = input.workspace
    return (input.teams ?? [])
      .map((t) =>
        choice(
          `choose:team:${t.slug}`,
          t.name,
          t.slug === input.routeTeam,
          { type: 'team', slug: t.slug },
          'team',
          `Opens ${t.name}.`,
          {
            team: { slug: t.slug, name: t.name, color: t.color, icon: t.icon },
            path: switchTeamPath(input.pathname, workspace, t.slug),
          },
        ),
      )
      .filter(keep)
  }
  if (state.page === 'workspace') {
    return input.workspaces
      .map((w) =>
        choice(
          `choose:workspace:${w.slug}`,
          w.name,
          w.slug === input.workspace,
          { type: 'workspace', slug: w.slug },
          'workspace',
          `Opens ${w.name}.`,
        ),
      )
      .filter(keep)
  }
  if (state.page === 'theme') {
    return THEME_CHOICES.map((t) =>
      choice(
        `choose:theme:${t.mode}`,
        t.label,
        t.mode === input.theme,
        { type: 'theme', mode: t.mode },
        'theme',
        t.mode === 'system' ? 'Follows your device.' : `Always ${t.label.toLowerCase()}.`,
      ),
    ).filter(keep)
  }
  return state.entry ? rowActionEntries(state.entry).filter(keep) : []
}

// Row actions ------------------------------------------------------------------------------

const action = (id: string, label: string, icon: IconKey, run: RowAction, line: string): Entry => ({
  id: `row:${id}`,
  group: '',
  kind: 'action',
  label,
  icon,
  target: { type: 'run', action: run },
  peek: { kind: 'Action', title: label, lines: [line], rows: [] },
})

/** What ⌘. lists for a row: the thing's own actions, then Copy link and Open in new tab. */
export function rowActionEntries(entry: Entry): Entry[] {
  const subject: Subject | undefined = entry.subject
  const rows: Entry[] = []
  if (subject?.type === 'build' || subject?.type === 'review') {
    const name = subject.label
    rows.push(
      action(
        'approve',
        subject.type === 'build' ? 'Approve all' : 'Approve',
        'approve',
        { type: 'review', subject, decision: 'approved' },
        `Approves ${name}.`,
      ),
      action(
        'reject',
        'Reject',
        'reject',
        { type: 'review', subject, decision: 'rejected' },
        `Rejects ${name}.`,
      ),
    )
  }
  if (subject?.type === 'triage') {
    rows.push(
      action(
        'assign',
        'Assign to me',
        'person',
        { type: 'assignMe', subject },
        'Assigns the item to you.',
      ),
      action(
        'snooze-tomorrow',
        'Snooze until tomorrow',
        'snooze',
        { type: 'snoozeTriage', subject, choice: 'tomorrow' },
        'Hides the item until tomorrow.',
      ),
      action(
        'snooze-week',
        'Snooze until next week',
        'snooze',
        { type: 'snoozeTriage', subject, choice: 'next_week' },
        'Hides the item until next week.',
      ),
      action(
        'dismiss',
        'Dismiss',
        'remove',
        { type: 'dismissTriage', subject },
        'Takes the item out of the queue.',
      ),
    )
  }
  if (subject?.type === 'notice') {
    rows.push(
      action(
        'read',
        subject.read ? 'Mark as unread' : 'Mark as read',
        'check',
        { type: 'read', subject, read: !subject.read },
        subject.read ? 'Makes the notice unread again.' : 'Marks the notice as read.',
      ),
      action(
        'snooze-tomorrow',
        'Snooze until tomorrow',
        'snooze',
        { type: 'snoozeNotice', subject, choice: 'tomorrow' },
        'Hides the notice until tomorrow.',
      ),
      action(
        'remove',
        'Remove',
        'remove',
        { type: 'removeNotice', subject },
        'Removes the notice from your inbox.',
      ),
    )
  }
  if (entry.path) {
    rows.push(
      action(
        'copy',
        'Copy link',
        'copy',
        { type: 'copyLink', path: entry.path },
        'Copies the link.',
      ),
      action(
        'tab',
        'Open in new tab',
        'open',
        { type: 'newTab', path: entry.path },
        'Opens it in a new tab.',
      ),
    )
  }
  return rows
}

/** Whether ⌘. has anything to list for a row. */
export const hasRowActions = (entry: Entry | undefined): boolean =>
  entry !== undefined && (entry.path !== undefined || entry.subject !== undefined)

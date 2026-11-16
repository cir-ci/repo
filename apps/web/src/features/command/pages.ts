import type { Sidebar } from '@circi/api'
import type { ColorMode } from '@circi/ui'

import { switchWorkspacePath, type WorkspaceRef } from '#app/shell-model.ts'
import { SHORTCUTS } from '#lib/shortcuts.ts'

import type {
  Entry,
  IconKey,
  PageId,
  Reviewer,
  ReviewSubject,
  RowAction,
  Subject,
} from './entry.ts'
import { matchScore, THEME_CHOICES, wordsOf } from './model.ts'

/**
 * The nested lists a row with a chevron opens (Switch project…, Switch workspace…, Theme…) and the
 * actions of one highlighted row (⌘.). A nested list replaces the main one: the field shows a chip
 * with its name and a new placeholder, rows show the current choice with a check, and Backspace in
 * the empty field or Esc goes back.
 */

export interface PageState {
  page: PageId
  /** The row whose actions are listed (page `row`). */
  entry?: Entry
  /** The rejection that waits for its reason (page `reason`). */
  action?: RowAction
  /** The build a review is asked for, and who is ticked so far (page `reviewers`). */
  subject?: ReviewSubject
  picked?: Reviewer[]
}

export const PAGE_META: Record<
  PageId,
  { chip: string; placeholder: string; noun: [string, string] }
> = {
  project: { chip: 'Switch project', placeholder: 'Find a project', noun: ['project', 'projects'] },
  workspace: {
    chip: 'Switch workspace',
    placeholder: 'Find a workspace',
    noun: ['workspace', 'workspaces'],
  },
  theme: { chip: 'Theme', placeholder: 'Choose a theme', noun: ['theme', 'themes'] },
  row: { chip: 'Actions', placeholder: 'Find an action', noun: ['action', 'actions'] },
  reason: { chip: 'Reject', placeholder: 'Why are you rejecting this?', noun: ['row', 'rows'] },
  reviewers: { chip: 'Request review', placeholder: 'Find a person', noun: ['person', 'people'] },
}

export interface PageInput {
  workspace: string | undefined
  pathname: string
  projects: readonly Sidebar.Project[] | undefined
  workspaces: readonly WorkspaceRef[]
  /** The project of the address, which is the current choice of Switch project. */
  routeProject: string | undefined
  theme: ColorMode
  /** The project's people (page `reviewers`), who is signed in, and the build author's user ID, both left out of the list. */
  members?: readonly Reviewer[] | undefined
  meId?: string | undefined
  authorId?: string | null | undefined
}

const enc = encodeURIComponent

/** Where choosing `slug` goes: the same section of that project (Triage stays Triage), else its builds. */
export function switchProjectPath(pathname: string, workspace: string, slug: string): string {
  const parts = pathname.split('/').filter(Boolean)
  const base = `/${enc(workspace)}/${enc(slug)}`
  const onProject =
    parts.length >= 3 && !['workspaces', 'account', 'instance', 'inbox'].includes(parts[0] ?? '')
  const section = onProject ? parts[2] : undefined
  if (section === 'triage' || section === 'baselines' || section === 'sites') {
    return `${base}/${section}`
  }
  return base
}

/** Where choosing a workspace goes, as the workspace switcher decides it. */
export function switchWorkspaceTarget(
  pathname: string,
  slug: string,
  projectOf: (workspace: string) => string | undefined,
): string | undefined {
  return switchWorkspacePath(pathname, slug, projectOf)
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
  if (state.page === 'project') {
    if (!input.workspace) return []
    const workspace = input.workspace
    return (input.projects ?? [])
      .map((t) =>
        choice(
          `choose:project:${t.slug}`,
          t.name,
          t.slug === input.routeProject,
          { type: 'project', slug: t.slug },
          'project',
          `Opens ${t.name}.`,
          {
            project: { slug: t.slug, name: t.name, color: t.color, icon: t.icon },
            path: switchProjectPath(input.pathname, workspace, t.slug),
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
  if (state.page === 'reason') return reasonEntries(state.action, query)
  if (state.page === 'reviewers') return reviewerEntries(state, input).filter(keep)
  return state.entry ? rowActionEntries(state.entry).filter(keep) : []
}

/** The one row of the reason step: Enter rejects with what is typed (nothing happens while it is empty). */
function reasonEntries(rejection: RowAction | undefined, query: string): Entry[] {
  if (rejection?.type !== 'review') return []
  const reason = query.trim()
  if (reason === '') {
    return [
      {
        id: 'reason:empty',
        group: '',
        kind: 'action',
        label: 'Type a reason to reject',
        icon: 'reject',
        target: { type: 'noop' },
        peek: {
          kind: 'Action',
          title: 'Reject',
          lines: [`${rejection.subject.label} needs a reason to be rejected.`],
          rows: [],
        },
      },
    ]
  }
  return [
    {
      id: 'reason:reject',
      group: '',
      kind: 'action',
      label: 'Reject with this reason',
      detail: reason,
      icon: 'reject',
      target: { type: 'run', action: { ...rejection, reason } },
      peek: {
        kind: 'Action',
        title: 'Reject',
        lines: [`Rejects ${rejection.subject.label} with your reason.`],
        rows: [{ label: 'Reason', value: reason }],
      },
    },
  ]
}

/** The people a review can be asked of: the project, without you and the build's author; ticked ones are checked. */
function reviewerEntries(state: PageState, input: PageInput): Entry[] {
  const subject = state.subject
  if (!subject) return []
  const picked = state.picked ?? []
  const rows: Entry[] = (input.members ?? [])
    .filter((m) => m.id !== input.meId && m.id !== input.authorId)
    .map((m) => {
      const ticked = picked.some((p) => p.id === m.id)
      return choice(
        `reviewer:${m.id}`,
        m.name,
        false,
        { type: 'reviewer', reviewer: { id: m.id, name: m.name }, subject },
        'person',
        picked.length > 0
          ? `Press Enter to ${ticked ? 'untick' : 'tick'} ${m.name}.`
          : `Asks ${m.name} to review ${subject.label}. Press ⇧↵ to pick several people.`,
        ticked ? { checked: true, detail: 'Selected' } : {},
      )
    })
  if (picked.length === 0) return rows
  const names = picked.map((p) => p.name).join(', ')
  return [
    {
      id: 'reviewers:ask',
      group: '',
      kind: 'action',
      label: `Request review from ${picked.length === 1 ? names : `${picked.length} people`}`,
      icon: 'person',
      target: { type: 'run', action: { type: 'requestReview', subject, reviewers: picked } },
      peek: {
        kind: 'Action',
        title: 'Request review',
        lines: [`Asks ${names} to review ${subject.label}.`],
        rows: [],
      },
    },
    ...rows,
  ]
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
        { type: 'review', subject, decision: 'rejected', names: 'undecided' },
        `Rejects the screenshots of ${name} that have no decision yet.`,
      ),
    )
    if (subject.type === 'build') {
      rows.push({
        ...action(
          'request-review',
          'Request review…',
          'person',
          { type: 'requestReview', subject, reviewers: [] },
          `Asks someone to review ${name}.`,
        ),
        target: { type: 'page', page: 'reviewers', subject },
        chevron: true,
      })
    }
    if (subject.type === 'review') {
      rows.push(
        ...(subject.snoozed
          ? [
              action(
                'unsnooze-request',
                'Unsnooze',
                'snooze',
                { type: 'unsnoozeRequest', subject },
                'Brings the request back.',
              ),
            ]
          : [
              action(
                'snooze-request-tomorrow',
                'Snooze until tomorrow',
                'snooze',
                { type: 'snoozeRequest', subject, choice: 'tomorrow' },
                'Hides the request until tomorrow.',
              ),
              action(
                'snooze-request-week',
                'Snooze until next week',
                'snooze',
                { type: 'snoozeRequest', subject, choice: 'next_week' },
                'Hides the request until next week.',
              ),
            ]),
      )
    }
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
      ...(subject.snoozed
        ? [
            action(
              'unsnooze',
              'Unsnooze',
              'snooze',
              { type: 'unsnoozeTriage', subject },
              'Puts the item back in the queue.',
            ),
          ]
        : [
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
          ]),
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
      subject.snoozed
        ? action(
            'unsnooze',
            'Unsnooze',
            'snooze',
            { type: 'unsnoozeNotice', subject },
            'Brings the notice back.',
          )
        : action(
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

/**
 * What a build page's registry action does when run from the menu: the decision (on the screenshot
 * in the address, else the ones with no decision yet), or `page` for the people list of Request
 * review. Undefined for keys that are not one of those, which the page handles itself.
 */
export function buildPageAction(
  key: string,
  build: { workspace: string; project: string; number: number; shot?: string | undefined },
): RowAction | { page: 'reviewers'; subject: ReviewSubject } | undefined {
  const type = SHORTCUTS.find((s) => s.key === key)?.action.type
  const subject: ReviewSubject = {
    type: 'build',
    workspace: build.workspace,
    project: build.project,
    number: build.number,
    label: `build #${build.number}`,
  }
  const names = build.shot ? [build.shot] : 'undecided'
  if (type === 'approve') return { type: 'review', subject, decision: 'approved', names }
  if (type === 'approveAll') {
    return { type: 'review', subject, decision: 'approved', names: 'undecided' }
  }
  if (type === 'reject') return { type: 'review', subject, decision: 'rejected', names }
  if (type === 'requestReview') return { page: 'reviewers', subject }
  return undefined
}

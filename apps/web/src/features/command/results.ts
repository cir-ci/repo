import type { Search, Sidebar } from '@circi/api'

import { notificationText } from '#features/inbox/api.ts'
import { buildStatus } from '#features/reviews/api.ts'

import type { Entry, Peek } from './entry.ts'

/**
 * Search results as entries: a kind icon and kind label, the name of the thing, one grey line,
 * and a peek that says what it is from what the answer already holds. Each kind arrives ranked
 * by the server; the order here is the server's.
 */

const enc = encodeURIComponent
const teamPath = (workspace: string, team: string) => `/${enc(workspace)}/${enc(team)}`

export const buildPath = (workspace: string, team: string, number: number) =>
  `${teamPath(workspace, team)}/builds/${number}`

/** The path segments of a screenshot name (the baseline route's splat), each encoded. */
const splat = (name: string) => name.split('/').map(enc).join('/')

const REVIEW_LABEL: Record<Search.Build['reviewStatus'], string> = {
  pending: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
}

const TRIAGE_NAME: Record<Search.Triage['kind'], string> = {
  flaky: 'Flaky',
  no_baseline: 'No baseline',
  failed: 'Failed build',
}

const REVIEW_TAB_NAME: Record<Search.Review['tab'], string> = {
  'for-you': 'Requested from you',
  created: 'Created by you',
  snoozed: 'Snoozed',
}

export interface ResultsContext {
  workspace: string
  teams: readonly Sidebar.Team[] | undefined
  /** Whether results may come from several teams: then a row names its team. */
  allTeams: boolean
}

const joinDetail = (...parts: (string | null | undefined | false)[]): string =>
  parts.filter(Boolean).join(' · ')

const peek = (kind: string, title: string, lines: string[], rows: Peek['rows'] = []): Peek => ({
  kind,
  title,
  lines,
  rows,
})

/** The reason line of a triage item: `Flaky on main`. */
export const triageReason = (t: Pick<Search.Triage, 'kind' | 'branch'>): string =>
  t.branch ? `${TRIAGE_NAME[t.kind]} on ${t.branch}` : TRIAGE_NAME[t.kind]

/** The title of a triage item: its screenshot, or the failed build. */
export const triageTitle = (t: Pick<Search.Triage, 'snapshotName' | 'buildNumber'>): string =>
  t.snapshotName ?? `Build #${t.buildNumber} failed`

const buildEntry = (c: ResultsContext, b: Search.Build): Entry => {
  const title = `#${b.number} ${b.name === 'default' ? '' : b.name}`.trim()
  const { status, label } = buildStatus(b)
  const path = buildPath(c.workspace, b.teamSlug, b.number)
  return {
    id: `build:${b.teamSlug}:${b.number}`,
    group: 'Builds',
    kind: 'build',
    label: title,
    detail: joinDetail(
      b.branch,
      c.allTeams && b.teamName,
      b.prNumber !== null && `PR #${b.prNumber}`,
    ),
    kindLabel: 'Build',
    icon: 'status',
    status,
    target: { type: 'path', path },
    path,
    subject: {
      type: 'build',
      workspace: c.workspace,
      team: b.teamSlug,
      number: b.number,
      label: `build #${b.number}`,
    },
    peek: peek(
      'Build',
      title,
      [`${label}. ${REVIEW_LABEL[b.reviewStatus]}.`],
      [
        { label: 'Team', value: b.teamName },
        ...(b.branch ? [{ label: 'Branch', value: b.branch }] : []),
        ...(b.prNumber === null ? [] : [{ label: 'Pull request', value: `#${b.prNumber}` }]),
      ],
    ),
  }
}

/** The build the field asks for by number, in the open team, before the answer arrives. */
export function jumpBuildEntry(
  workspace: string,
  team: { slug: string; name: string },
  number: number,
): Entry {
  const path = buildPath(workspace, team.slug, number)
  return {
    id: `build:${team.slug}:${number}`,
    group: 'Builds',
    kind: 'build',
    label: `Build #${number}`,
    detail: team.name,
    kindLabel: 'Build',
    icon: 'status',
    status: 'needs-review',
    target: { type: 'path', path },
    path,
    peek: peek('Build', `Build #${number}`, [`Goes to build #${number} of ${team.name}.`]),
  }
}

export function resultEntries(c: ResultsContext, results: Search.Results | undefined): Entry[] {
  if (!results) return []
  const { workspace } = c
  const entries: Entry[] = results.builds.map((b) => buildEntry(c, b))
  for (const b of results.branches) {
    const path = buildPath(workspace, b.teamSlug, b.latestBuildNumber)
    entries.push({
      id: `branch:${b.teamSlug}:${b.branch}`,
      group: 'Branches',
      kind: 'branch',
      label: b.branch,
      detail: c.allTeams ? b.teamName : '',
      kindLabel: 'Branch',
      icon: 'branch',
      target: { type: 'path', path },
      path,
      subject: { type: 'link', label: `branch ${b.branch}` },
      peek: peek(
        'Branch',
        b.branch,
        [`Goes to its latest build, #${b.latestBuildNumber}.`],
        [{ label: 'Team', value: b.teamName }],
      ),
    })
  }
  for (const t of results.teams) {
    const team = c.teams?.find((x) => x.slug === t.slug)
    const path = teamPath(workspace, t.slug)
    entries.push({
      id: `team:${t.slug}`,
      group: 'Teams',
      kind: 'team',
      label: t.name,
      kindLabel: 'Team',
      icon: team ? 'team' : 'teams',
      ...(team ? { team: { slug: t.slug, name: t.name, color: team.color, icon: team.icon } } : {}),
      target: { type: 'path', path },
      path,
      subject: { type: 'link', label: `team ${t.name}` },
      peek: peek('Team', t.name, [`Goes to the builds of ${t.name}.`]),
    })
  }
  for (const s of results.snapshots) {
    const path = `${buildPath(workspace, s.teamSlug, s.latestBuildNumber)}?shot=${enc(s.name)}`
    entries.push({
      id: `snapshot:${s.teamSlug}:${s.name}`,
      group: 'Screenshots',
      kind: 'screenshot',
      label: s.name,
      detail: c.allTeams ? s.teamName : '',
      kindLabel: 'Screenshot',
      icon: 'image',
      target: { type: 'path', path },
      path,
      subject: { type: 'link', label: `screenshot ${s.name}` },
      peek: peek(
        'Screenshot',
        s.name,
        [`Latest in build #${s.latestBuildNumber}.`],
        [{ label: 'Team', value: s.teamName }],
      ),
    })
  }
  for (const b of results.baselines) {
    const path = `${teamPath(workspace, b.teamSlug)}/baselines/${splat(b.name)}`
    entries.push({
      id: `baseline:${b.teamSlug}:${b.name}`,
      group: 'Baselines',
      kind: 'baseline',
      label: b.name,
      detail: c.allTeams ? b.teamName : '',
      kindLabel: 'Baseline',
      icon: 'layers',
      target: { type: 'path', path },
      path,
      subject: { type: 'link', label: `baseline ${b.name}` },
      peek: peek(
        'Baseline',
        b.name,
        [`Approved in build #${b.buildNumber}.`],
        [{ label: 'Team', value: b.teamName }],
      ),
    })
  }
  for (const t of results.triage) {
    const title = triageTitle(t)
    const path = `${teamPath(workspace, t.teamSlug)}/triage?item=${enc(`${t.kind}:${t.key}`)}`
    entries.push({
      id: `triage:${t.teamSlug}:${t.kind}:${t.key}`,
      group: 'Triage',
      kind: 'triage',
      label: title,
      detail: joinDetail(triageReason(t), c.allTeams && t.teamName),
      kindLabel: 'Triage',
      icon: 'alert',
      target: { type: 'path', path },
      path,
      subject: {
        type: 'triage',
        workspace,
        team: t.teamSlug,
        kind: t.kind,
        key: t.key,
        label: title,
      },
      peek: peek(
        'Triage',
        title,
        [`${triageReason(t)}.`],
        [
          { label: 'Team', value: t.teamName },
          { label: 'Build', value: `#${t.buildNumber}` },
        ],
      ),
    })
  }
  for (const n of results.notifications) {
    const { title, detail } = notificationText(n)
    const path = `/inbox?tab=${n.tab}&item=${enc(n.id)}`
    entries.push({
      id: `notification:${n.id}`,
      group: 'Inbox',
      kind: 'notice',
      label: title,
      detail: c.allTeams ? (n.team?.name ?? '') : '',
      kindLabel: 'Inbox',
      icon: 'bell',
      unread: !n.read,
      target: { type: 'path', path },
      path,
      subject: { type: 'notice', id: n.id, read: n.read, label: title },
      peek: peek(
        'Inbox',
        title,
        [detail ?? (n.read ? 'Read.' : 'Unread.')],
        [
          ...(n.actor ? [{ label: 'From', value: n.actor.name }] : []),
          ...(n.team ? [{ label: 'Team', value: n.team.name }] : []),
          { label: 'Status', value: n.read ? 'Read' : 'Unread' },
        ],
      ),
    })
  }
  for (const r of results.reviews) {
    const title = `Review #${r.build.number}`
    const path = `/workspaces/${enc(workspace)}/reviews?tab=${r.tab}&review=${enc(r.id)}`
    entries.push({
      id: `review:${r.id}`,
      group: 'Review requests',
      kind: 'review',
      label: title,
      detail: joinDetail(
        r.requestedBy ? `from ${r.requestedBy.name}` : r.build.branch,
        c.allTeams && r.teamName,
      ),
      kindLabel: 'Review request',
      icon: 'eye',
      target: { type: 'path', path },
      path,
      subject: {
        type: 'review',
        workspace,
        team: r.teamSlug,
        number: r.build.number,
        id: r.id,
        label: `build #${r.build.number}`,
      },
      peek: peek(
        'Review request',
        title,
        [
          r.requestedBy
            ? `${r.requestedBy.name} asked ${r.reviewer.name} to review it.`
            : `${r.reviewer.name} is asked to review it.`,
        ],
        [
          { label: 'Team', value: r.teamName },
          ...(r.build.branch ? [{ label: 'Branch', value: r.build.branch }] : []),
          { label: 'In', value: REVIEW_TAB_NAME[r.tab] },
        ],
      ),
    })
  }
  for (const v of results.views) {
    const path = `/workspaces/${enc(workspace)}/views/${enc(v.id)}`
    entries.push({
      id: `view:${v.id}`,
      group: 'Saved views',
      kind: 'view',
      label: v.name,
      kindLabel: 'Saved view',
      icon: 'sliders',
      target: { type: 'path', path },
      path,
      subject: { type: 'link', label: `view ${v.name}` },
      peek: peek('Saved view', v.name, ['Opens the saved view.']),
    })
  }
  return entries
}

/** The word for a number of results of a kind: `builds`, `triage items`. */
export const KIND_NOUN: Record<Search.Kind, [string, string]> = {
  builds: ['build', 'builds'],
  branches: ['branch', 'branches'],
  teams: ['team', 'teams'],
  snapshots: ['screenshot', 'screenshots'],
  baselines: ['baseline', 'baselines'],
  triage: ['triage item', 'triage items'],
  notifications: ['notice', 'notices'],
  reviews: ['review request', 'review requests'],
  views: ['saved view', 'saved views'],
}

/** The heading of each group of results, in the order a tie between them is broken. */
export const RESULT_GROUPS = [
  'Builds',
  'Branches',
  'Screenshots',
  'Baselines',
  'Triage',
  'Inbox',
  'Review requests',
  'Saved views',
  'Teams',
] as const

/** Which kind of the answer each group heading shows. */
export const GROUP_KIND: Record<(typeof RESULT_GROUPS)[number], Search.Kind> = {
  Builds: 'builds',
  Branches: 'branches',
  Screenshots: 'snapshots',
  Baselines: 'baselines',
  Triage: 'triage',
  Inbox: 'notifications',
  'Review requests': 'reviews',
  'Saved views': 'views',
  Teams: 'teams',
}

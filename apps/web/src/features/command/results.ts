import type { Search, Sidebar } from '@circi/api'

import { notificationText } from '#features/inbox/api.ts'
import { buildStatus } from '#features/reviews/api.ts'

import type { Entry, Peek } from './entry.ts'
import { shortAgo } from './recent.ts'

/**
 * Search results as entries: a kind icon and kind label, the name of the thing, one grey line,
 * and a peek that says what it is from what the answer already holds. Each kind arrives ranked
 * by the server; the order here is the server's.
 */

const enc = encodeURIComponent
const projectPath = (workspace: string, project: string) => `/${enc(workspace)}/${enc(project)}`

export const buildPath = (workspace: string, project: string, number: number) =>
  `${projectPath(workspace, project)}/builds/${number}`

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
  'for-you': 'Needs your review',
  created: 'Created by you',
  snoozed: 'Snoozed',
}

export interface ResultsContext {
  workspace: string
  projects: readonly Sidebar.Project[] | undefined
  /** Whether results may come from several projects: then a row names its project. */
  allProjects: boolean
  /** The time the ages are counted to (ms); now when left out. */
  now?: number
}

const joinDetail = (...parts: (string | null | undefined | false)[]): string =>
  parts.filter(Boolean).join(' · ')

const peek = (
  kind: string,
  title: string,
  lines: string[],
  rows: Peek['rows'] = [],
  extra: Pick<Peek, 'thumb' | 'avatar'> = {},
): Peek => ({
  kind,
  title,
  lines,
  rows,
  ...extra,
})

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What a build changed, in words: `3 changed, 1 added`; empty when nothing did. */
export function changeWords(c: Search.Build['changes']): string {
  return [
    c.changed > 0 && `${c.changed} changed`,
    c.added > 0 && `${c.added} added`,
    c.removed > 0 && `${c.removed} removed`,
  ]
    .filter(Boolean)
    .join(', ')
}

/** The Reviews page filtered to one person's review requests (it finds by the name of the asked or the asking). */
export const personPath = (workspace: string, name: string) =>
  `/workspaces/${enc(workspace)}/reviews?tab=all-open&q=${enc(name)}`

/** The reason line of a triage item: `Flaky on main`. */
export const triageReason = (t: Pick<Search.Triage, 'kind' | 'branch'>): string =>
  t.branch ? `${TRIAGE_NAME[t.kind]} on ${t.branch}` : TRIAGE_NAME[t.kind]

/** The title of a triage item: its screenshot, or the failed build. */
export const triageTitle = (t: Pick<Search.Triage, 'snapshotName' | 'buildNumber'>): string =>
  t.snapshotName ?? `Build #${t.buildNumber} failed`

const buildEntry = (c: ResultsContext, b: Search.Build): Entry => {
  const title = `#${b.number} ${b.name === 'default' ? '' : b.name}`.trim()
  const { status, label } = buildStatus(b)
  const path = buildPath(c.workspace, b.projectSlug, b.number)
  return {
    id: `build:${b.projectSlug}:${b.number}`,
    group: 'Builds',
    kind: 'build',
    label: title,
    detail: joinDetail(
      b.branch,
      c.allProjects && b.projectName,
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
      project: b.projectSlug,
      number: b.number,
      label: `build #${b.number}`,
    },
    peek: peek(
      'Build',
      title,
      [`${label}. ${REVIEW_LABEL[b.reviewStatus]}.`],
      [
        { label: 'Project', value: b.projectName },
        ...(b.branch ? [{ label: 'Branch', value: b.branch }] : []),
        ...(b.prNumber === null ? [] : [{ label: 'Pull request', value: `#${b.prNumber}` }]),
        ...(changeWords(b.changes) ? [{ label: 'Changes', value: changeWords(b.changes) }] : []),
      ],
      b.thumbnail ? { thumb: b.thumbnail } : {},
    ),
  }
}

/** The build the field asks for by number, in the open project, before the answer arrives. */
export function jumpBuildEntry(
  workspace: string,
  project: { slug: string; name: string },
  number: number,
): Entry {
  const path = buildPath(workspace, project.slug, number)
  return {
    id: `build:${project.slug}:${number}`,
    group: 'Builds',
    kind: 'build',
    label: `Build #${number}`,
    detail: project.name,
    kindLabel: 'Build',
    icon: 'status',
    status: 'needs-review',
    target: { type: 'path', path },
    path,
    peek: peek('Build', `Build #${number}`, [`Goes to build #${number} of ${project.name}.`]),
  }
}

export function resultEntries(c: ResultsContext, results: Search.Results | undefined): Entry[] {
  if (!results) return []
  const { workspace } = c
  const entries: Entry[] = results.builds.map((b) => buildEntry(c, b))
  for (const b of results.branches) {
    const path = buildPath(workspace, b.projectSlug, b.latestBuildNumber)
    entries.push({
      id: `branch:${b.projectSlug}:${b.branch}`,
      group: 'Branches',
      kind: 'branch',
      label: b.branch,
      detail: c.allProjects ? b.projectName : '',
      kindLabel: 'Branch',
      icon: 'branch',
      target: { type: 'path', path },
      path,
      subject: { type: 'link', label: `branch ${b.branch}` },
      peek: peek(
        'Branch',
        b.branch,
        [`Goes to its latest build, #${b.latestBuildNumber}.`],
        [{ label: 'Project', value: b.projectName }],
      ),
    })
  }
  for (const t of results.projects) {
    const project = c.projects?.find((x) => x.slug === t.slug)
    const path = projectPath(workspace, t.slug)
    entries.push({
      id: `project:${t.slug}`,
      group: 'Projects',
      kind: 'project',
      label: t.name,
      kindLabel: 'Project',
      icon: project ? 'project' : 'projects',
      ...(project
        ? { project: { slug: t.slug, name: t.name, color: project.color, icon: project.icon } }
        : {}),
      target: { type: 'path', path },
      path,
      subject: { type: 'link', label: `project ${t.name}` },
      peek: peek('Project', t.name, [`Goes to the builds of ${t.name}.`]),
    })
  }
  for (const s of results.snapshots) {
    const path = `${buildPath(workspace, s.projectSlug, s.latestBuildNumber)}?shot=${enc(s.name)}`
    entries.push({
      id: `snapshot:${s.projectSlug}:${s.name}`,
      group: 'Screenshots',
      kind: 'screenshot',
      label: s.name,
      detail: c.allProjects ? s.projectName : '',
      kindLabel: 'Screenshot',
      icon: 'image',
      target: { type: 'path', path },
      path,
      subject: { type: 'link', label: `screenshot ${s.name}` },
      peek: peek(
        'Screenshot',
        s.name,
        [`Latest in build #${s.latestBuildNumber}.`],
        [{ label: 'Project', value: s.projectName }],
        s.thumbnail ? { thumb: s.thumbnail } : {},
      ),
    })
  }
  for (const b of results.baselines) {
    const path = `${projectPath(workspace, b.projectSlug)}/baselines/${splat(b.name)}`
    entries.push({
      id: `baseline:${b.projectSlug}:${b.name}`,
      group: 'Baselines',
      kind: 'baseline',
      label: b.name,
      detail: c.allProjects ? b.projectName : '',
      kindLabel: 'Baseline',
      icon: 'layers',
      target: { type: 'path', path },
      path,
      subject: { type: 'link', label: `baseline ${b.name}` },
      peek: peek(
        'Baseline',
        b.name,
        [`Approved in build #${b.buildNumber}.`],
        [
          { label: 'Project', value: b.projectName },
          ...(b.approvedBy ? [{ label: 'Approved by', value: b.approvedBy }] : []),
        ],
        b.thumbnail ? { thumb: b.thumbnail } : {},
      ),
    })
  }
  for (const t of results.triage) {
    const title = triageTitle(t)
    const path = `${projectPath(workspace, t.projectSlug)}/triage?item=${enc(`${t.kind}:${t.key}`)}`
    entries.push({
      id: `triage:${t.projectSlug}:${t.kind}:${t.key}`,
      group: 'Triage',
      kind: 'triage',
      label: title,
      detail: joinDetail(triageReason(t), c.allProjects && t.projectName),
      kindLabel: 'Triage',
      icon: 'alert',
      target: { type: 'path', path },
      path,
      subject: {
        type: 'triage',
        workspace,
        project: t.projectSlug,
        kind: t.kind,
        key: t.key,
        label: title,
        snoozed: t.snoozed,
      },
      peek: peek(
        'Triage',
        title,
        [`${triageReason(t)}.`],
        [
          { label: 'Project', value: t.projectName },
          { label: 'Build', value: `#${t.buildNumber}` },
          { label: 'Assignee', value: t.assignee?.name ?? 'Nobody' },
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
      detail: c.allProjects ? (n.project?.name ?? '') : '',
      kindLabel: 'Inbox',
      icon: 'bell',
      unread: !n.read,
      target: { type: 'path', path },
      path,
      subject: {
        type: 'notice',
        id: n.id,
        read: n.read,
        snoozed: n.tab === 'snoozed',
        label: title,
      },
      peek: peek(
        'Inbox',
        title,
        [detail ?? (n.read ? 'Read.' : 'Unread.')],
        [
          ...(n.actor ? [{ label: 'From', value: n.actor.name }] : []),
          ...(n.project ? [{ label: 'Project', value: n.project.name }] : []),
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
        c.allProjects && r.projectName,
      ),
      kindLabel: 'Review request',
      icon: 'eye',
      target: { type: 'path', path },
      path,
      subject: {
        type: 'review',
        workspace,
        project: r.projectSlug,
        number: r.build.number,
        id: r.id,
        label: `build #${r.build.number}`,
        snoozed: r.tab === 'snoozed',
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
          { label: 'Project', value: r.projectName },
          ...(r.build.branch ? [{ label: 'Branch', value: r.build.branch }] : []),
          { label: 'Asked', value: shortAgo(Date.parse(r.createdAt), c.now ?? Date.now()) },
          { label: 'In', value: REVIEW_TAB_NAME[r.tab] },
        ],
      ),
    })
  }
  for (const p of results.people) {
    const path = personPath(workspace, p.name)
    entries.push({
      id: `person:${p.id}`,
      group: 'People',
      kind: 'person',
      label: p.name,
      detail: p.email,
      kindLabel: 'Person',
      icon: 'person',
      avatar: { id: p.id, name: p.name, image: p.image },
      target: { type: 'path', path },
      path,
      subject: { type: 'link', label: `person ${p.name}` },
      peek: peek(
        'Person',
        p.name,
        [p.email],
        [
          {
            label: 'Projects',
            value:
              p.projects.length > 0 ? p.projects.map((t) => t.name).join(', ') : 'None you can see',
          },
          { label: 'Open reviews', value: count(p.openReviews, 'request', 'requests') },
        ],
        { avatar: { id: p.id, name: p.name, image: p.image } },
      ),
      keywords: [p.email],
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
  projects: ['project', 'projects'],
  snapshots: ['screenshot', 'screenshots'],
  baselines: ['baseline', 'baselines'],
  triage: ['triage item', 'triage items'],
  notifications: ['notice', 'notices'],
  reviews: ['review request', 'review requests'],
  views: ['saved view', 'saved views'],
  people: ['person', 'people'],
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
  'People',
  'Projects',
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
  People: 'people',
  Projects: 'projects',
}

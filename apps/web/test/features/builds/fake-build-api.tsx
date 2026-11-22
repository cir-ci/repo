import type { Activity, Build, Comment, Flaky, IgnoreRegion, Issue, Snapshot } from '@circi/api'

import { BuildPage } from '#features/builds/BuildPage.tsx'
import { validateBuildSearch } from '#features/builds/search.ts'
import { deferred, fakeApi, type FakeRequest, type Reply } from '#test/support/fetch.ts'
import { projectInfo } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'

let nextId = 0

export const image = (sha256: string, width = 400, height = 300) => ({
  sha256,
  width,
  height,
})

/** A screenshot with both images (so it can be compared) unless `over` says otherwise. */
export function shot(
  name: string,
  status: NonNullable<Build.DiffItem['status']>,
  over: Partial<Build.DiffItem> = {},
): Build.DiffItem {
  const n = ++nextId
  const comparable = status === 'changed'
  return {
    id: `d${n}`,
    name,
    status,
    score: comparable ? 0.0123 : null,
    changedPixels: comparable ? 120 : null,
    sizeChanged: false,
    errorMessage: null,
    head: status === 'removed' ? null : { ...image(`head${n}`), thumbnail: null, metadata: {} },
    base: status === 'added' ? null : { ...image(`base${n}`), thumbnail: null },
    diff: comparable ? image(`diff${n}`) : null,
    review: null,
    ...over,
  }
}

/** A decision on a snapshot, as the API returns it. */
export const decision = (
  state: 'approved' | 'rejected',
  reason: string | null = null,
): NonNullable<Build.DiffItem['review']> => ({
  decision: state,
  reviewer: { id: 'u1', name: 'Ada Lovelace' },
  at: new Date().toISOString(),
  reason,
})

export function detail(
  over: Partial<Build.Detail['build']> = {},
  rest: Partial<Build.Detail> = {},
) {
  const diffs = rest.diffs ?? [
    shot('checkout / payment', 'changed'),
    shot('checkout / address', 'changed'),
    shot('home', 'added'),
    shot('pricing', 'unchanged'),
    shot('about', 'unchanged'),
  ]
  const count = (s: string) => diffs.filter((d) => d.status === s).length
  const result: Build.Detail = {
    project: projectInfo({ slug: 'web-app', name: 'web-app', workspaceName: 'Acme' }),
    build: {
      id: 'b7',
      number: 7,
      name: 'default',
      commitSha: '0123456789abcdef',
      branch: 'feature/checkout',
      prNumber: 42,
      status: 'complete',
      conclusion: 'changes_detected',
      reviewStatus: 'pending',
      createdAt: new Date().toISOString(),
      counts: {
        added: count('added'),
        removed: count('removed'),
        changed: count('changed'),
        unchanged: count('unchanged'),
        failed: count('failed'),
        total: diffs.length,
      },
      baseBranch: 'main',
      ancestryStatus: 'ok',
      baselineSource: 'provider',
      errorMessage: null,
      ...over,
      author: over.author ?? null,
      completedAt: over.completedAt !== undefined ? over.completedAt : new Date().toISOString(),
    },
    baseline: { number: 6, commitSha: 'fedcba9876543210', branch: 'main' },
    reviews: [],
    diffs,
    issues: [],
    reviewTarget: { hours: 24, dueAt: null },
    authorUserId: null,
    watchers: [],
    pullRequest: { number: 42, repo: null },
    ...rest,
  }
  return result
}

export interface FakeApi {
  /** What `GET …/builds/7` returns now; the review route changes `reviewStatus` of it. */
  build: Build.Detail
  /** `GET …/flaky`. */
  flaky: { name: string; changedIn: number; reason: Flaky.Reason }[]
  /** Answers the review POST with an error instead. */
  reviewError: string | null
  /** The bodies of the review POSTs, in order. */
  reviews: string[]
  /** The tokens of the undo POSTs, in order; each puts the build back as it was before its decision. */
  undos: string[]
  /** Answers the undo POST with this refusal (409) instead. */
  undoRefusal: string | null
  /** `GET …/comments`; a POST appends to it. */
  comments: Comment.Item[]
  /** `GET …/activity`. */
  activity: Activity.Event[]
  /** `GET …/snapshots/:name/history`: the screenshot through recent builds of main (any name). */
  history: Snapshot.HistoryEntry[]
  /** `GET …/issues`: the issues filed from this build and the trackers its project has. */
  issues: Issue.List
  /** The bodies of the comment POSTs, in order. */
  commentPosts: Comment.Create[]
  /** The bodies of the review-request POSTs, in order. */
  requests: unknown[]
  /** The project's members: `GET …/members` answers with these. */
  members: { id: string; userId: string; user: { name: string; email: string } }[]
  /** `GET …/settings`: owners and admins can manage ignore regions, members can't. */
  canManage: boolean
  /** `GET …/ignore-regions`; a POST appends to it. */
  ignoreRegions: IgnoreRegion.Item[]
  /** The bodies of the ignore-region POSTs, in order. */
  ignorePosts: { name: string; x: number; y: number; width: number; height: number }[]
  /** The bodies of the ignore-region PATCHes (a moved or resized region), in order. */
  ignorePatches: { id: string; x: number; y: number; width: number; height: number }[]
  /** The bodies of the comment-region PATCHes (a moved or resized comment region), in order. */
  regionPatches: { id: string; x: number; y: number; width: number; height: number }[]
  /** Answers the region PATCHes (ignore and comment) with an error instead. */
  regionError: string | null
  /**
   * Holds back the answer to every POST whose path ends with `suffix` until `release()` (answers
   * as usual) or `refuse()` (a 500, "Not allowed"): a slow network, with no timer.
   */
  holdPost: (suffix: string) => { release: () => void; refuse: () => void }
}

const json = (body: unknown, status = 200): Reply => ({ body, status })

/** A request's JSON body, as the build API's handlers read it. */
const parsed = (call: FakeRequest) => JSON.parse(JSON.stringify(call.body ?? {}))

/** Stubs `fetch` with the build API (the network edge) and returns the state it serves. */
export function fakeBuildApi(build: Build.Detail): FakeApi {
  /** The build before each decision, by the token its answer carried. */
  const before = new Map<string, Build.Detail>()
  const token = (previous: Build.Detail) => {
    const id = `undo-${before.size + 1}`
    before.set(id, previous)
    return { id, expiresAt: '2099-01-01T00:00:00.000Z' }
  }
  const api: FakeApi = {
    build,
    flaky: [],
    reviewError: null,
    reviews: [],
    undos: [],
    undoRefusal: null,
    comments: [],
    activity: [],
    issues: { issues: [], trackers: [] },
    commentPosts: [],
    requests: [],
    members: [],
    canManage: false,
    ignoreRegions: [],
    ignorePosts: [],
    ignorePatches: [],
    regionPatches: [],
    regionError: null,
    history: [],
    holdPost: (suffix) => {
      const gate = deferred<'ok' | 'refused'>()
      holds.push({ suffix, gate: gate.promise })
      return { release: () => gate.resolve('ok'), refuse: () => gate.resolve('refused') }
    },
  }
  const holds: { suffix: string; gate: Promise<'ok' | 'refused'> }[] = []
  fakeApi({}, (call) => {
    const url = { pathname: call.path, searchParams: new URLSearchParams(call.search) }
    const method = call.method
    const held = method === 'POST' ? holds.find((h) => url.pathname.endsWith(h.suffix)) : undefined
    if (held) {
      return async () =>
        (await held.gate) === 'refused'
          ? json({ error: 'Not allowed' }, 500)
          : (answer(call, url) ?? json({ error: 'not found' }, 404))
    }
    return answer(call, url)
  })
  /** The answer to one request, `undefined` for a route the fake doesn't have. */
  function answer(
    call: FakeRequest,
    url: { pathname: string; searchParams: URLSearchParams },
  ): Reply | undefined {
    const method = call.method
    if (/^\/api\/projects\/acme\/web-app\/snapshots\/.+\/history$/.test(url.pathname)) {
      return json({ defaultBranch: 'main', default: api.history, branch: null })
    }
    if (url.pathname === '/api/projects/acme/web-app/builds/7/review' && method === 'POST') {
      if (api.reviewError) return json({ error: api.reviewError }, 500)
      const body = JSON.stringify(call.body ?? '')
      api.reviews.push(body)
      const state = JSON.parse(body).state === 'rejected' ? 'rejected' : 'approved'
      const undo = token(api.build)
      api.build = { ...api.build, build: { ...api.build.build, reviewStatus: state } }
      return json({ build: { reviewStatus: state }, undo })
    }
    const root = '/api/projects/acme/web-app/builds/7'
    if (url.pathname === `${root}/snapshots/review` && method === 'POST') {
      if (api.reviewError) return json({ error: api.reviewError }, 500)
      const body = JSON.stringify(call.body ?? '')
      api.reviews.push(body)
      const { snapshotNames, decision: state, reason } = JSON.parse(body)
      const undo = token(api.build)
      const diffs = api.build.diffs.map((d) =>
        snapshotNames.includes(d.name) ? { ...d, review: decision(state, reason ?? null) } : d,
      )
      const changed = diffs.filter((d) => d.status !== null && d.status !== 'unchanged')
      const reviewStatus = changed.some((d) => d.review?.decision === 'rejected')
        ? 'rejected'
        : changed.every((d) => d.review?.decision === 'approved')
          ? 'approved'
          : 'pending'
      api.build = { ...api.build, diffs, build: { ...api.build.build, reviewStatus } }
      return json({ build: { reviewStatus }, undo })
    }
    const undoRoute = /^\/api\/projects\/acme\/web-app\/undo\/([^/]+)$/.exec(url.pathname)
    if (undoRoute && method === 'POST') {
      const id = undoRoute[1] ?? ''
      api.undos.push(id)
      if (api.undoRefusal) return json({ error: api.undoRefusal }, 409)
      const previous = before.get(id)
      if (previous) api.build = previous
      return json({ undone: true })
    }
    if (url.pathname === `${root}/comments` && method === 'POST') {
      const body = parsed(call)
      api.commentPosts.push(body)
      api.comments.push({
        id: `c${api.comments.length + 1}`,
        parentId: body.parentId ?? null,
        snapshotName: body.snapshotName ?? null,
        region: body.region ?? null,
        regionSide: body.regionSide ?? 'current',
        body: body.body,
        author: { id: 'u1', name: 'Ada Lovelace', image: null },
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        mine: true,
        canDelete: true,
      })
      return json({ id: `c${api.comments.length}` }, 201)
    }
    const regionPatch = new RegExp(`^${root}/comments/([^/]+)/region$`).exec(url.pathname)
    if (regionPatch && method === 'PATCH') {
      if (api.regionError) return json({ error: api.regionError }, 400)
      const id = regionPatch[1] ?? ''
      const body = parsed(call)
      api.regionPatches.push({ id, ...body })
      api.comments = api.comments.map((c) => (c.id === id ? { ...c, region: body } : c))
      return json(api.comments.find((c) => c.id === id))
    }
    if (url.pathname === `${root}/comments`) return json({ comments: api.comments })
    if (url.pathname === `${root}/activity`) return json({ events: api.activity })
    if (url.pathname === `${root}/issues`) return json(api.issues)
    if (url.pathname === '/api/projects/acme/web-app/builds/request-review' && method === 'POST') {
      const asked = parsed(call)
      api.requests.push(asked)
      return json({
        requests: asked.reviewerIds.map((reviewerId: string) => ({
          id: 'r1',
          state: 'open',
          dueAt: null,
          created: true,
          buildId: asked.buildIds[0],
          reviewerId,
        })),
        undo: { id: 'undo-request', expiresAt: '2099-01-01T00:00:00.000Z' },
      })
    }
    if (url.pathname === '/api/projects/acme/web-app/undo/undo-request' && method === 'POST') {
      api.undos.push('undo-request')
      return json({ undone: true })
    }
    // Signed in as Ada (u1): the request-review picker leaves her out.
    if (url.pathname === '/api/auth/get-session')
      return json({
        session: { id: 's1', userId: 'u1', expiresAt: '2099-01-01T00:00:00.000Z', token: 't' },
        user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.test', emailVerified: true },
      })
    if (url.pathname === '/api/auth/organization/get-full-organization')
      return json({
        id: 'workspace1',
        name: 'Acme',
        slug: 'acme',
        members: api.members,
        invitations: [],
      })
    const project = '/api/projects/acme/web-app'
    if (url.pathname === `${project}/members`)
      return json({
        members: api.members.map((m) => ({
          id: m.userId,
          name: m.user.name,
          email: m.user.email,
          image: null,
          role: 'member',
          addedAt: '2026-11-01T00:00:00.000Z',
        })),
        canManage: false,
      })
    if (url.pathname === `${project}/settings`) return json({ canManage: api.canManage })
    if (url.pathname === `${project}/ignore-regions` && method === 'POST') {
      const body = parsed(call)
      api.ignorePosts.push(body)
      const item = {
        id: `r${api.ignoreRegions.length + 1}`,
        createdAt: new Date().toISOString(),
        createdBy: { id: 'u1', name: 'Ada Lovelace' },
        ...body,
      }
      api.ignoreRegions.push(item)
      return json(item, 201)
    }
    const ignorePatch = new RegExp(`^${project}/ignore-regions/([^/]+)$`).exec(url.pathname)
    if (ignorePatch && method === 'PATCH') {
      if (api.regionError) return json({ error: api.regionError }, 400)
      const id = ignorePatch[1] ?? ''
      const body = parsed(call)
      api.ignorePatches.push({ id, ...body })
      api.ignoreRegions = api.ignoreRegions.map((r) => (r.id === id ? { ...r, ...body } : r))
      return json(api.ignoreRegions.find((r) => r.id === id))
    }
    if (url.pathname === `${project}/ignore-regions`) {
      const name = url.searchParams.get('name')
      return json({
        regions: api.ignoreRegions.filter((r) => name === null || r.name === name),
        snapshots: [],
      })
    }
    if (url.pathname === root) return json(api.build)
    if (url.pathname === '/api/projects/acme/web-app/flaky')
      return json({ builds: 10, flaky: api.flaky })
    return undefined
  }
  return api
}

/** Renders the real build page at its route, with the theme, announcer, query client and router. */
/**
 * The build page at `url`, in a column as tall as the window, as the app's panel holds it: the
 * viewer's row takes the height left, whatever the sidebar's content.
 */
export async function renderBuild(url = '/acme/web-app/builds/7') {
  const ui = (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <BuildPage />
    </div>
  )
  const { router } = await renderPage(ui, {
    route: '$workspace/$project/builds/$number',
    url,
    announcer: true,
    validateSearch: validateBuildSearch,
  })
  return { router }
}

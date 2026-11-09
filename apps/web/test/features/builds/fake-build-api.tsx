import type { Activity, Build, Comment, Issue } from '@circi/api'
import { vi } from 'vitest'

import { BuildPage } from '#features/builds/BuildPage.tsx'
import { validateBuildSearch } from '#features/builds/search.ts'
import { teamInfo } from '#test/support/fixtures.ts'
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
    team: teamInfo({ slug: 'web-app', name: 'web-app', workspaceName: 'Acme' }),
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
    ...rest,
  }
  return result
}

export interface FakeApi {
  /** What `GET …/builds/7` returns now; the review route changes `reviewStatus` of it. */
  build: Build.Detail
  /** `GET …/flaky`. */
  flaky: { name: string; changedIn: number }[]
  /** Answers the review POST with an error instead. */
  reviewError: string | null
  /** The bodies of the review POSTs, in order. */
  reviews: string[]
  /** `GET …/comments`; a POST appends to it. */
  comments: Comment.Item[]
  /** `GET …/activity`. */
  activity: Activity.Event[]
  /** `GET …/issues`: the issues filed from this build and the trackers its team has. */
  issues: Issue.List
  /** The bodies of the comment POSTs, in order. */
  commentPosts: Comment.Create[]
  /** The bodies of the review-request POSTs, in order. */
  requests: unknown[]
  /** The workspace's members, as better-auth returns them. */
  members: { id: string; userId: string; user: { name: string; email: string } }[]
  fetch: ReturnType<typeof vi.fn<typeof fetch>>
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

/** Stubs `fetch` with the build API (the network edge) and returns the state it serves. */
export function fakeBuildApi(build: Build.Detail): FakeApi {
  const api: FakeApi = {
    build,
    flaky: [],
    reviewError: null,
    reviews: [],
    comments: [],
    activity: [],
    issues: { issues: [], trackers: [] },
    commentPosts: [],
    requests: [],
    members: [],
    fetch: vi.fn<typeof fetch>((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
      const method = init?.method ?? 'GET'
      if (url.pathname === '/api/teams/acme/web-app/builds/7/review' && method === 'POST') {
        if (api.reviewError) return json({ error: api.reviewError }, 500)
        const body = typeof init?.body === 'string' ? init.body : ''
        api.reviews.push(body)
        const state = JSON.parse(body).state === 'rejected' ? 'rejected' : 'approved'
        api.build = { ...api.build, build: { ...api.build.build, reviewStatus: state } }
        return json({ build: { reviewStatus: state } })
      }
      const root = '/api/teams/acme/web-app/builds/7'
      if (url.pathname === `${root}/snapshots/review` && method === 'POST') {
        if (api.reviewError) return json({ error: api.reviewError }, 500)
        const body = typeof init?.body === 'string' ? init.body : ''
        api.reviews.push(body)
        const { snapshotNames, decision: state, reason } = JSON.parse(body)
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
        return json({ build: { reviewStatus } })
      }
      if (url.pathname === `${root}/comments` && method === 'POST') {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}')
        api.commentPosts.push(body)
        api.comments.push({
          id: `c${api.comments.length + 1}`,
          parentId: body.parentId ?? null,
          snapshotName: body.snapshotName ?? null,
          region: body.region ?? null,
          regionSide: body.regionSide ?? 'current',
          body: body.body,
          author: { id: 'u1', name: 'Ada Lovelace' },
          createdAt: new Date().toISOString(),
          editedAt: null,
          deletedAt: null,
          mine: true,
          canDelete: true,
        })
        return json({ id: `c${api.comments.length}` }, 201)
      }
      if (url.pathname === `${root}/comments`) return json({ comments: api.comments })
      if (url.pathname === `${root}/activity`) return json({ events: api.activity })
      if (url.pathname === `${root}/issues`) return json(api.issues)
      if (url.pathname === `${root}/review-requests` && method === 'POST') {
        api.requests.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'))
        return json({ id: 'r1', state: 'open', dueAt: null, created: true }, 201)
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
      if (url.pathname === root) return json(api.build)
      if (url.pathname === '/api/teams/acme/web-app/flaky')
        return json({ builds: 10, flaky: api.flaky })
      return json({ error: 'not found' }, 404)
    }),
  }
  vi.stubGlobal('fetch', api.fetch)
  return api
}

/** Renders the real build page at its route, with the theme, announcer, query client and router. */
export async function renderBuild(url = '/acme/web-app/builds/7') {
  const { router } = await renderPage(<BuildPage />, {
    route: '$workspace/$team/builds/$number',
    url,
    announcer: true,
    validateSearch: validateBuildSearch,
  })
  return { router }
}

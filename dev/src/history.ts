import type { PersonKey } from './config.ts'
import {
  type Change,
  type Screen,
  BASELINE,
  STORYBOOK,
  accent,
  addPage,
  background,
  banner,
  band,
  broken,
  buttonLeft,
  cards,
  gallery,
  pagesOf,
  resize,
  tick,
  removePage,
  same,
  together,
} from './screens.ts'

/** Someone's decision on a build, `hours` after the build was ready. */
export interface ReviewStep {
  by: PersonKey
  state: 'approved' | 'rejected'
  reason?: string
  hours: number
}

/** Decisions on some screenshots of a build (`names`), or on every one without a decision yet. */
export interface SnapshotReviewStep {
  by: PersonKey
  decision: 'approved' | 'rejected'
  names: string[] | 'undecided'
  reason?: string
}

/** A comment on a build (or on one screenshot, or a spot on it), `hours` after the build was ready. */
export interface CommentStep {
  by: PersonKey
  body: string
  snapshot?: string
  region?: { x: number; y: number; width: number; height: number }
  /** A reply to the comment before it in the same build. */
  reply?: boolean
  hours: number
}

/** One CI upload: what the seed does for a build, in the order the builds happened. */
export interface Step {
  project: string
  /** How long before the seed ran the build finished (fractions of a day are fine). */
  daysAgo: number
  branch: string
  pr?: number
  message: string
  author: PersonKey
  screens: Screen[]
  /** A named build (several kinds of build per commit). */
  name?: string
  /** One shard of two never arrives: the build ends in an error. */
  failed?: boolean
  reviews: ReviewStep[]
  comments: CommentStep[]
  /** People the author asks to look at it. */
  requests: PersonKey[]
  /** Decisions on single screenshots (after the build-wide `reviews`). */
  snapshotReviews: SnapshotReviewStep[]
  /** CI ran the same commit again (same screenshots): the server carries the earlier decision over. */
  rerun?: boolean
  /** The checkout has no history to compare with, so the baseline is the latest build on main. */
  noAncestry?: boolean
  /** One of two shards arrived and the other never will: the build stays "uploading". */
  partial?: boolean
}

interface Extras {
  snapshotReviews?: SnapshotReviewStep[]
  noAncestry?: boolean
  reviews?: ReviewStep[]
  comments?: CommentStep[]
  requests?: PersonKey[]
  /** The pull request lands on main this many days later (a build on main with the same pages). */
  merge?: number
}

const approve = (by: PersonKey, hours: number): ReviewStep => ({ by, state: 'approved', hours })
const reject = (by: PersonKey, reason: string, hours: number): ReviewStep => ({
  by,
  state: 'rejected',
  reason,
  hours,
})
const say = (
  by: PersonKey,
  hours: number,
  body: string,
  where: Pick<CommentStep, 'snapshot' | 'region' | 'reply'> = {},
): CommentStep => ({ by, hours, body, ...where })

/** A project's builds, written oldest first; `main` is the pages as the default branch has them. */
function timeline(project: string, base: Screen[]) {
  let main = base
  const steps: Step[] = []
  /** The pages on main after each build on it, oldest first: what a pull request of that day was compared with. */
  const mains: { daysAgo: number; screens: Screen[] }[] = [{ daysAgo: 1000, screens: base }]
  const mainAt = (daysAgo: number): Screen[] =>
    mains.findLast((m) => m.daysAgo >= daysAgo)?.screens ?? base
  const push = (
    step: Omit<Step, 'project' | 'reviews' | 'comments' | 'requests' | 'snapshotReviews'> & Extras,
    track = true,
  ) => {
    const { merge: _merge, ...rest } = step
    if (track && step.branch === 'main' && !step.name && !step.failed && !step.partial) {
      mains.push({ daysAgo: step.daysAgo, screens: step.screens })
    }
    steps.push({
      reviews: [],
      comments: [],
      requests: [],
      snapshotReviews: [],
      ...rest,
      project,
    })
  }
  return {
    steps,
    mainAt,
    /** The same commit again, as CI does when a job is re-run: same screenshots, an earlier decision carries over. */
    rerun(daysAgo: number, branch: string) {
      const earlier = steps.findLast((x) => x.branch === branch && !x.failed && !x.partial)
      if (!earlier) throw new Error(`${project}: nothing to re-run on ${branch}`)
      push({
        daysAgo,
        branch,
        message: earlier.message,
        author: earlier.author,
        screens: earlier.screens,
        rerun: true,
        ...(earlier.pr ? { pr: earlier.pr } : {}),
      })
    },
    /** A pull request compared with the pages main had on that day, which leaves main alone (for the filler). */
    prAt(
      daysAgo: number,
      branch: string,
      number: number,
      message: string,
      author: PersonKey,
      change: Change,
      extras: Extras = {},
    ) {
      push({
        daysAgo,
        branch,
        pr: number,
        message,
        author,
        screens: change(mainAt(daysAgo)),
        ...extras,
      })
    },
    /** A build on main that adds nothing new: the pages main had that day. */
    nightly(daysAgo: number, message: string, author: PersonKey) {
      push({ daysAgo, branch: 'main', message, author, screens: mainAt(daysAgo) }, false)
    },
    /** A build whose second shard never comes and that nothing has failed yet. */
    partial(daysAgo: number, message: string, author: PersonKey) {
      push({ daysAgo, branch: 'main', message, author, screens: main, partial: true })
    },
    /** A build on the default branch. Its changes are approved automatically; the first one is approved by hand. */
    main(
      daysAgo: number,
      message: string,
      author: PersonKey,
      change: Change = same,
      extras: Extras = {},
    ) {
      main = change(main)
      push({ daysAgo, branch: 'main', message, author, screens: main, ...extras })
    },
    /** A pull request's build; pushing again to the same branch is another call with the same number. */
    pr(
      daysAgo: number,
      branch: string,
      number: number,
      message: string,
      author: PersonKey,
      change: Change,
      extras: Extras = {},
    ) {
      const screens = change(main)
      push({ daysAgo, branch, pr: number, message, author, screens, ...extras })
      if (extras.merge !== undefined) {
        main = screens
        push({
          daysAgo: daysAgo - extras.merge,
          branch: 'main',
          message: `Merge ${branch} (#${number})`,
          author,
          screens,
        })
      }
    },
    /** A named build that has no baseline yet. */
    named(daysAgo: number, name: string, message: string, author: PersonKey, screens: Screen[]) {
      push({ daysAgo, branch: 'main', message, author, screens, name })
    },
    /** A build on main whose second shard never arrived. */
    failed(daysAgo: number, message: string, author: PersonKey) {
      push({ daysAgo, branch: 'main', message, author, screens: main, failed: true })
    },
  }
}

const REGION = { x: 0.08, y: 0.12, width: 0.4, height: 0.22 }
const LOWER = { x: 0.3, y: 0.55, width: 0.35, height: 0.25 }

/** Alternating changes on main: each build returns the page to an image it already had, so Triage lists it as flaky. */
const flipDashboard = (i: number): Change =>
  together(
    banner('dashboard/overview', i % 2 === 0 ? '#06d6a0' : undefined),
    buttonLeft('settings/billing', i % 2 === 0),
  )
const flipCart = (i: number): Change => banner('m/cart', i % 2 === 0 ? '#ffd166' : undefined)

// ---------------------------------------------------------------------------------------------
// Filler: many more pull requests per project, spread over the weeks, with every size of change.
// ---------------------------------------------------------------------------------------------

type Timeline = ReturnType<typeof timeline>

/** A small seeded random generator, so every first run seeds the same data. */
function random(seed: string): () => number {
  let a = 0
  for (const ch of seed) a = (Math.imul(a, 31) + ch.charCodeAt(0)) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** What a pull request does to one page; the share of the page that changes is the diff score. */
const KINDS = [
  'small',
  'none',
  'medium',
  'tiny',
  'large',
  'small',
  'size',
  'add',
  'medium',
  'none',
  'remove',
  'small',
  'huge',
  'tiny',
] as const
type Kind = (typeof KINDS)[number]

const TITLES = [
  'Tighten the spacing',
  'Update the icons',
  'Refresh the empty state',
  'Rework the header',
  'Align the cards',
  'New loading skeleton',
  'Larger touch targets',
  'Fix the overflow',
  'Swap the illustration',
  'Polish the focus ring',
  'Table density option',
  'Restyle the tabs',
  'Better error message',
  'Tune the dark mode',
]

function changeFor(kind: Kind, page: string, extra: string, pages: string[], i: number): Change {
  switch (kind) {
    case 'tiny':
      return band(page, 0.003)
    case 'small':
      return band(page, i % 2 === 0 ? 0.04 : 0.09)
    case 'medium':
      return band(page, 0.2)
    case 'large':
      return band(page, 0.4)
    case 'huge':
      return background(page, '#fde7c8')
    case 'size':
      return resize(page, 960, 640)
    case 'add':
      return addPage({ name: extra, accent: '#3355dd', cards: 2, columns: 2 })
    case 'remove':
      return removePage(pages.at(-1) ?? page)
    default:
      return same
  }
}

interface Fill {
  /** From this many days ago to that many days ago. */
  from: number
  to: number
  count: number
  /** Branch and page prefix; PR numbers start at `first`. */
  prefix: string
  first: number
  pages: string[]
  authors: PersonKey[]
  reviewers: PersonKey[]
  /** Builds in the last days stay undecided, and ask these people. */
  pendingDays?: number
}

/**
 * Pull requests that are never merged (main stays as the story above left it), so each is
 * compared with the pages main had that day. About half are decided, a few rejected with a
 * comment thread, the newest wait for a review.
 */
function fill(t: Timeline, f: Fill): void {
  const rand = random(`${t.steps[0]?.project}-${f.prefix}`)
  const span = f.from - f.to
  const pendingDays = f.pendingDays ?? 7
  for (let i = 0; i < f.count; i++) {
    const daysAgo = f.from - (span * i) / Math.max(1, f.count - 1) + (i % 5) * 0.013
    const kind = KINDS[(i + Math.floor(rand() * 3)) % KINDS.length] ?? 'small'
    const page = f.pages[Math.floor(rand() * Math.max(1, f.pages.length - 2))] ?? 'home'
    const author = f.authors[i % f.authors.length] ?? 'owner'
    const reviewer =
      f.reviewers.find((r, k) => r !== author && k === i % f.reviewers.length) ??
      f.reviewers.find((r) => r !== author) ??
      author
    const other = f.reviewers.find((r) => r !== reviewer && r !== author) ?? reviewer
    const decided = daysAgo > pendingDays && kind !== 'none' && i % 3 !== 2
    const hours = 2 + Math.floor(rand() * 40)
    const reviews: ReviewStep[] = []
    const comments: CommentStep[] = []
    if (decided) {
      if (i % 4 === 1) {
        reviews.push(reject(reviewer, 'This is not what the design shows.', hours))
        comments.push(
          say(reviewer, hours - 1, 'Compare the lower part with the design.', {
            snapshot: page,
            region: i % 2 === 0 ? REGION : LOWER,
          }),
          say(author, hours, 'Good catch, fixing it.', { reply: true }),
        )
        if (i % 8 === 1)
          comments.push(say(reviewer, hours + 1, 'Thanks, looks right now.', { reply: true }))
      } else reviews.push(approve(reviewer, hours))
    }
    const waiting = !decided && kind !== 'none'
    const tail = i % 11 === 3 ? ` (${f.prefix} ${i})` : ''
    t.prAt(
      daysAgo,
      `${f.prefix}/${TITLES[i % TITLES.length]?.toLowerCase().replaceAll(' ', '-')}-${i}`,
      f.first + i,
      `${TITLES[i % TITLES.length]}${tail}`,
      author,
      changeFor(kind, page, `${f.prefix}/new-${i}`, f.pages, i),
      {
        reviews,
        comments,
        // Asked, then decided (the Reviewed tab), or still waiting (For you, Created, Overdue).
        ...(waiting
          ? { requests: i % 2 === 0 ? [reviewer, other] : [reviewer] }
          : decided && i % 2 === 0
            ? { requests: [reviewer] }
            : {}),
      },
    )
  }
}

/** Alternating changes on main, `n` of them from `from` days ago (a page that keeps changing back and forth). */
function flips(t: Timeline, page: string, from: number, n: number, authors: PersonKey[]): void {
  for (let i = 0; i < n; i++) {
    t.main(
      from - i,
      `Tweak ${page} (${i + 1})`,
      authors[i % authors.length] ?? 'owner',
      banner(page, i % 2 === 0 ? '#06d6a0' : undefined),
    )
  }
}

/** Builds on the default branch that change nothing: the runs Insights and the list show. */
function mainRun(t: Timeline, from: number, to: number, count: number, authors: PersonKey[]): void {
  for (let i = 0; i < count; i++) {
    const daysAgo = from - ((from - to) * i) / Math.max(1, count - 1) + 0.02
    t.nightly(daysAgo, `Nightly build ${i + 1}`, authors[i % authors.length] ?? 'owner')
  }
}

function webApp(): Step[] {
  const t = timeline('web-app', BASELINE)
  t.main(88, 'Add the app shell', 'owner', same, { reviews: [approve('owner', 2)] })
  t.pr(84, 'feat/pricing-table', 3, 'Add a pricing table', 'sofia', cards('pricing', 4, 4), {
    reviews: [approve('priya', 5)],
    comments: [
      say('priya', 4, 'Four columns read better than three here.', { snapshot: 'pricing' }),
    ],
    merge: 0.5,
  })
  t.pr(80, 'fix/typos', 4, 'Fix typos', 'liam', same)
  t.pr(
    76,
    'feat/login-redesign',
    5,
    'Redesign the login page',
    'member',
    accent('login', '#7a3ddb'),
    {
      reviews: [reject('owner', 'The button should stay centered, see the design.', 20)],
      comments: [
        say(
          'owner',
          19,
          'The primary button moved. @member can you check the spacing against the design?',
          {
            snapshot: 'login',
            region: REGION,
          },
        ),
        say('member', 21, 'Will do, the spacing is off by a few pixels.', { reply: true }),
      ],
    },
  )
  t.pr(
    75,
    'feat/login-redesign',
    5,
    'Keep the login button centered',
    'member',
    accent('login', '#7a3ddb'),
    {
      reviews: [approve('owner', 3)],
      merge: 0.2,
    },
  )
  t.pr(
    70,
    'feat/settings-tabs',
    6,
    'Tabs on the settings pages',
    'priya',
    together(cards('settings/profile', 3, 1), buttonLeft('settings/billing', true)),
    {
      reviews: [approve('member', 30)],
      merge: 1,
    },
  )
  t.failed(66, 'Split the end-to-end job in two', 'liam')
  t.pr(63, 'chore/deps', 7, 'Update dependencies', 'hannah', same)
  t.pr(
    60,
    'feat/onboarding',
    8,
    'Add the onboarding welcome page',
    'sofia',
    together(
      addPage({ name: 'onboarding/welcome', accent: '#3355dd', cards: 2, columns: 2 }),
      banner('home', '#ffd166'),
    ),
    {
      reviews: [
        reject('owner', "The yellow banner on the home page wasn't part of the design.", 9),
      ],
      requests: ['owner', 'member'],
    },
  )
  t.pr(
    59,
    'feat/onboarding',
    8,
    'Drop the home banner',
    'sofia',
    addPage({ name: 'onboarding/welcome', accent: '#3355dd', cards: 2, columns: 2 }),
    {
      reviews: [approve('member', 4)],
      merge: 0.3,
    },
  )
  t.pr(52, 'feat/dark-footer', 9, 'Footer styles', 'liam', accent('home', '#1b2a49'), {
    reviews: [reject('owner', 'Contrast is too low on the footer links.', 26)],
  })
  t.pr(
    47,
    'feat/new-charts',
    10,
    'New dashboard charts',
    'owner',
    cards('dashboard/overview', 6, 3),
    {
      reviews: [approve('member', 6)],
      comments: [
        say('member', 5, 'Charts line up now. Approving.', {
          snapshot: 'dashboard/overview',
          region: LOWER,
        }),
      ],
      merge: 1,
    },
  )
  t.failed(41, 'Retry the flaky end-to-end shard', 'member')
  t.pr(38, 'fix/billing-copy', 11, 'Billing copy', 'priya', same)
  t.pr(
    33,
    'feat/empty-states',
    12,
    'Empty states',
    'hannah',
    addPage({ name: 'dashboard/empty', accent: '#3355dd', sidebar: 200, cards: 1, columns: 1 }),
    {
      reviews: [approve('priya', 14)],
      merge: 2,
    },
  )
  t.pr(24, 'feat/avatar-menu', 13, 'Avatar menu', 'member', cards('settings/profile', 4, 1), {
    reviews: [approve('owner', 3)],
    comments: [say('owner', 2, 'Nice. @priya.nair this touches the settings page you own.')],
    merge: 1,
  })
  t.pr(
    14,
    'feat/alert-banner',
    14,
    'Show an alert banner on the dashboard',
    'member',
    banner('dashboard/overview', '#ef476f'),
    {
      reviews: [reject('owner', 'The banner covers the charts; move it below the title.', 7)],
      comments: [
        say('owner', 6, 'The banner hides the first chart.', {
          snapshot: 'dashboard/overview',
          region: REGION,
        }),
      ],
    },
  )
  t.pr(
    12,
    'feat/alert-banner',
    14,
    'Move the banner below the title',
    'member',
    banner('dashboard/overview', '#f77f00'),
    {
      reviews: [approve('owner', 2)],
    },
  )
  t.named(9, 'storybook', 'Add Storybook', 'sofia', STORYBOOK)
  t.pr(7, 'fix/typos-2', 15, 'More typos', 'liam', same)
  // Two screens that keep changing back and forth on main: Triage lists them as flaky.
  t.main(6, 'Tweak the dashboard (1)', 'owner', flipDashboard(0))
  t.main(5, 'Tweak the dashboard (2)', 'priya', flipDashboard(1))
  t.main(4, 'Tweak the dashboard (3)', 'owner', flipDashboard(2))
  t.main(3, 'Tweak the dashboard (4)', 'priya', flipDashboard(3))
  t.pr(
    2.5,
    'feat/redesign',
    16,
    'Redesign home, pricing and onboarding',
    'member',
    together(
      accent('home', '#7a3ddb'),
      cards('pricing', 4, 4),
      removePage('onboarding/welcome'),
      addPage({
        name: 'onboarding/steps',
        accent: '#3355dd',
        cards: 3,
        columns: 3,
        banner: '#ffd166',
      }),
    ),
    {
      requests: ['owner', 'priya'],
      comments: [
        say(
          'priya',
          2,
          '@owner I started on the settings pages, but the new home page needs your eye.',
          { snapshot: 'home' },
        ),
        say('member', 2.5, 'Pricing is a four-column grid now, same as the design.', {
          snapshot: 'pricing',
          region: LOWER,
        }),
      ],
    },
  )
  t.main(2, 'Tweak the dashboard (5)', 'owner', flipDashboard(4))
  t.pr(
    1.5,
    'feat/search',
    17,
    'Search in the header',
    'priya',
    accent('dashboard/overview', '#7a3ddb'),
    {
      requests: ['member'],
    },
  )
  t.pr(0.4, 'feat/export', 18, 'Export to CSV', 'hannah', cards('settings/profile', 4, 2), {})
  // Depth: a run of nightly builds, CI re-runs, a build without history, an unreadable screenshot.
  t.rerun(46.4, 'feat/new-charts')
  t.rerun(51.4, 'feat/dark-footer')
  t.prAt(
    20.5,
    'fix/detached-ci',
    120,
    'CI checkout without history',
    'liam',
    band('settings/profile', 0.12),
    { noAncestry: true, requests: ['owner'] },
  )
  t.prAt(10, 'fix/export-broken', 121, 'Broken export screenshot', 'hannah', broken('pricing'), {
    requests: ['member'],
  })
  t.prAt(
    8,
    'chore/clock',
    122,
    'Show the time in the header',
    'priya',
    together(tick('home', 3), tick('dashboard/overview', 5)),
  )
  t.partial(0.01, 'Upload from a runner that stopped', 'liam')
  mainRun(t, 85, 3.4, 22, ['owner', 'priya', 'member'])
  fill(t, {
    from: 87,
    to: 0.3,
    count: 40,
    prefix: 'ui',
    first: 100,
    pages: [
      'home',
      'login',
      'pricing',
      'dashboard/overview',
      'settings/profile',
      'settings/billing',
    ],
    authors: ['member', 'sofia', 'liam', 'hannah', 'priya'],
    reviewers: ['owner', 'member', 'priya'],
  })
  return t.steps
}

function api(): Step[] {
  const t = timeline(
    'api-server',
    pagesOf('#8a4fff', [
      'docs/overview',
      'docs/auth',
      'docs/endpoints',
      'docs/errors',
      'docs/changelog',
    ]),
  )
  t.main(85, 'Generate the reference docs', 'daniel', same, { reviews: [approve('daniel', 3)] })
  t.pr(78, 'feat/rate-limits', 21, 'Document rate limits', 'tomas', cards('docs/endpoints', 5, 2), {
    reviews: [approve('priya', 8)],
    merge: 0.4,
  })
  t.pr(
    70,
    'docs/auth-guide',
    22,
    'Rewrite the auth guide',
    'priya',
    accent('docs/auth', '#5b2fd0'),
    {
      reviews: [approve('daniel', 22)],
      merge: 0.5,
    },
  )
  t.failed(62, 'Publish docs from CI', 'tomas')
  t.pr(
    55,
    'feat/webhooks-docs',
    23,
    'Document webhooks',
    'tomas',
    addPage({ name: 'docs/webhooks', accent: '#8a4fff', cards: 3, columns: 1 }),
    {
      reviews: [reject('daniel', 'The retry section is missing.', 12)],
      comments: [
        say('daniel', 11, 'Please add how retries and backoff work.', {
          snapshot: 'docs/webhooks',
        }),
      ],
    },
  )
  t.pr(
    54,
    'feat/webhooks-docs',
    23,
    'Add the retry section',
    'tomas',
    addPage({ name: 'docs/webhooks', accent: '#8a4fff', cards: 4, columns: 2 }),
    {
      reviews: [approve('daniel', 6)],
      merge: 0.5,
    },
  )
  t.pr(30, 'fix/typos-docs', 24, 'Fix typos in the docs', 'priya', same)
  t.pr(18, 'feat/sdk-snippets', 25, 'SDK snippets', 'daniel', cards('docs/overview', 6, 2), {
    reviews: [approve('owner', 40)],
    merge: 2,
  })
  t.pr(
    8,
    'feat/pagination-docs',
    26,
    'Document pagination',
    'tomas',
    addPage({ name: 'docs/pagination', accent: '#8a4fff', cards: 2, columns: 2 }),
    {
      requests: ['daniel'],
    },
  )
  t.pr(
    1,
    'docs/changelog-2',
    27,
    'Changelog for the next release',
    'priya',
    accent('docs/changelog', '#5b2fd0'),
    {},
  )
  t.rerun(53.9, 'feat/webhooks-docs')
  t.prAt(
    14,
    'fix/errors-page',
    120,
    'Broken error codes screenshot',
    'tomas',
    broken('docs/errors'),
    {},
  )
  flips(t, 'docs/overview', 9, 6, ['daniel', 'priya'])
  mainRun(t, 84, 10, 14, ['daniel', 'tomas'])
  fill(t, {
    from: 86,
    to: 0.5,
    count: 24,
    prefix: 'docs',
    first: 100,
    pages: ['docs/overview', 'docs/auth', 'docs/endpoints', 'docs/errors', 'docs/changelog'],
    authors: ['tomas', 'priya', 'daniel'],
    reviewers: ['daniel', 'priya', 'owner'],
  })
  return t.steps
}

function storybook(): Step[] {
  const t = timeline(
    'storybook',
    pagesOf('#ef476f', [
      'storybook/button',
      'storybook/card',
      'storybook/modal',
      'storybook/tooltip',
      'storybook/tabs',
      'storybook/table',
    ]),
  )
  t.main(86, 'Add Storybook', 'sofia', same, { reviews: [approve('sofia', 1)] })
  t.pr(80, 'feat/tooltip-arrow', 31, 'Tooltip arrow', 'liam', cards('storybook/tooltip', 3, 3), {
    reviews: [approve('sofia', 6)],
    merge: 0.3,
  })
  t.pr(72, 'feat/modal-sizes', 32, 'Modal sizes', 'member', banner('storybook/modal', '#118ab2'), {
    reviews: [reject('sofia', 'The small modal needs a visible close button.', 10)],
  })
  t.pr(
    71,
    'feat/modal-sizes',
    32,
    'Modal sizes with a close button',
    'member',
    together(banner('storybook/modal', '#118ab2'), accent('storybook/modal', '#d6335a')),
    {
      reviews: [approve('sofia', 3)],
      merge: 0.4,
    },
  )
  t.pr(60, 'chore/rename-tokens', 33, 'Rename tokens', 'liam', same)
  t.pr(49, 'feat/table-density', 34, 'Table density', 'sofia', cards('storybook/table', 3, 2), {
    reviews: [approve('member', 4)],
    merge: 1,
  })
  t.failed(40, 'Build Storybook on the new runner', 'liam')
  t.pr(28, 'feat/tabs-overflow', 35, 'Tabs that scroll', 'liam', cards('storybook/tabs', 2, 2), {
    reviews: [reject('member', 'The scroll arrows are cut off.', 30)],
  })
  t.pr(
    20,
    'feat/button-loading',
    36,
    'Loading state for buttons',
    'sofia',
    buttonLeft('storybook/button', true),
    {
      reviews: [approve('liam', 5)],
      comments: [
        say('liam', 4, 'The spinner is centered in every size.', { snapshot: 'storybook/button' }),
      ],
      merge: 0.5,
    },
  )
  t.pr(5, 'feat/card-media', 37, 'Cards with media', 'liam', cards('storybook/card', 4, 2), {
    requests: ['sofia', 'member'],
  })
  t.pr(
    0.8,
    'feat/modal-focus',
    38,
    'Modal focus ring',
    'sofia',
    accent('storybook/modal', '#118ab2'),
    {},
  )
  t.rerun(19.8, 'feat/button-loading')
  t.prAt(
    12,
    'fix/tooltip-asset',
    120,
    'Corrupt tooltip screenshot',
    'liam',
    broken('storybook/tooltip'),
    {},
  )
  flips(t, 'storybook/button', 9, 5, ['sofia', 'liam'])
  mainRun(t, 85, 10, 14, ['sofia', 'liam'])
  fill(t, {
    from: 86,
    to: 0.5,
    count: 22,
    prefix: 'sb',
    first: 100,
    pages: [
      'storybook/button',
      'storybook/card',
      'storybook/modal',
      'storybook/tooltip',
      'storybook/tabs',
      'storybook/table',
    ],
    authors: ['liam', 'sofia', 'member'],
    reviewers: ['sofia', 'member', 'liam'],
  })
  return t.steps
}

function designSystem(): Step[] {
  const t = timeline(
    'design-system',
    pagesOf('#2f9e6b', [
      'tokens/colors',
      'tokens/spacing',
      'tokens/typography',
      'components/button',
      'components/input',
    ]),
  )
  t.main(87, 'Publish the tokens', 'amara', same, { reviews: [approve('sofia', 4)] })
  t.pr(
    75,
    'feat/new-greys',
    41,
    'A warmer grey scale',
    'amara',
    accent('tokens/colors', '#4d7c5f'),
    {
      reviews: [approve('sofia', 7)],
      merge: 0.5,
    },
  )
  t.pr(
    64,
    'feat/spacing-scale',
    42,
    'A 4px spacing scale',
    'sofia',
    cards('tokens/spacing', 6, 3),
    {
      reviews: [reject('amara', 'We agreed on an 8px base, not 4px.', 18)],
    },
  )
  t.pr(
    40,
    'feat/input-states',
    43,
    'Input error and disabled states',
    'amara',
    cards('components/input', 4, 2),
    {
      reviews: [approve('owner', 26)],
      merge: 1,
    },
  )
  t.pr(22, 'feat/type-scale', 44, 'Fluid type scale', 'sofia', cards('tokens/typography', 6, 2), {
    reviews: [approve('amara', 9)],
    comments: [
      say('amara', 8, 'The heading sizes match the Figma file now.', {
        snapshot: 'tokens/typography',
        region: REGION,
      }),
    ],
    merge: 0.4,
  })
  t.failed(15, 'Run the visual tests on the new runner', 'amara')
  t.pr(6, 'feat/button-sizes', 45, 'Button sizes', 'amara', cards('components/button', 5, 3), {
    requests: ['sofia'],
  })
  t.pr(
    1.2,
    'fix/focus-ring',
    46,
    'Focus ring colour',
    'sofia',
    accent('components/input', '#1f7a50'),
    {},
  )
  t.rerun(39.8, 'feat/input-states')
  t.rerun(63.7, 'feat/spacing-scale')
  flips(t, 'tokens/colors', 9, 7, ['amara', 'sofia'])
  mainRun(t, 86, 10, 12, ['amara', 'sofia'])
  fill(t, {
    from: 86,
    to: 0.6,
    count: 22,
    prefix: 'ds',
    first: 100,
    pages: [
      'tokens/colors',
      'tokens/spacing',
      'tokens/typography',
      'components/button',
      'components/input',
    ],
    authors: ['amara', 'sofia', 'owner'],
    reviewers: ['sofia', 'amara', 'owner'],
  })
  return t.steps
}

function marketing(): Step[] {
  const t = timeline(
    'marketing-site',
    pagesOf('#7b8a2d', ['home', 'blog/index', 'blog/post', 'pricing', 'about', 'careers']),
  )
  t.main(89, 'Launch the new site', 'hannah', same, { reviews: [approve('owner', 2)] })
  t.pr(82, 'blog/launch-post', 51, 'Launch blog post', 'hannah', cards('blog/post', 4, 1), {
    reviews: [approve('amara', 5)],
    merge: 0.3,
  })
  t.pr(
    68,
    'feat/careers-page',
    52,
    'Open roles on the careers page',
    'amara',
    cards('careers', 6, 2),
    {
      reviews: [approve('hannah', 20)],
      merge: 1,
    },
  )
  t.pr(57, 'feat/home-hero', 53, 'New home hero', 'member', banner('home', '#ffd166'), {
    reviews: [reject('hannah', 'The hero image is cropped on wide screens.', 8)],
    comments: [
      say('hannah', 7, 'Crop looks wrong on the right side.', { snapshot: 'home', region: LOWER }),
    ],
  })
  t.pr(56, 'feat/home-hero', 53, 'Hero image that scales', 'member', banner('home', '#ffc233'), {
    reviews: [approve('hannah', 3)],
    merge: 0.2,
  })
  t.failed(44, 'Deploy preview timed out', 'hannah')
  t.pr(35, 'blog/case-study', 54, 'Case study post', 'hannah', cards('blog/index', 6, 3), {
    reviews: [approve('amara', 10)],
    merge: 1,
  })
  t.pr(21, 'feat/pricing-faq', 55, 'FAQ on the pricing page', 'amara', cards('pricing', 5, 3), {
    reviews: [reject('owner', 'The FAQ pushes the plans below the fold.', 30)],
  })
  t.pr(9, 'feat/about-team', 56, 'Team photos on the about page', 'hannah', cards('about', 4, 2), {
    requests: ['owner'],
  })
  t.pr(2, 'blog/changelog', 57, 'Changelog post', 'amara', cards('blog/post', 5, 1), {})
  t.prAt(
    18,
    'fix/ci-no-history',
    120,
    'Preview build without history',
    'amara',
    band('about', 0.15),
    { noAncestry: true },
  )
  mainRun(t, 86, 3, 16, ['hannah', 'amara'])
  fill(t, {
    from: 87,
    to: 0.4,
    count: 24,
    prefix: 'mk',
    first: 100,
    pages: ['home', 'blog/index', 'blog/post', 'pricing', 'about', 'careers'],
    authors: ['hannah', 'amara', 'member'],
    reviewers: ['hannah', 'owner', 'amara'],
    pendingDays: 10,
  })
  return t.steps
}

function mobileWeb(): Step[] {
  const t = timeline(
    'mobile-web',
    pagesOf('#4b4f5c', ['m/home', 'm/menu', 'm/cart', 'm/checkout', 'm/account']),
  )
  t.main(84, 'First mobile build', 'tomas', same, { reviews: [approve('owner', 2)] })
  t.pr(77, 'feat/bottom-nav', 61, 'Bottom navigation', 'tomas', cards('m/menu', 5, 1), {
    reviews: [approve('liam', 6)],
    merge: 0.5,
  })
  t.pr(66, 'feat/cart-badge', 62, 'Cart badge', 'liam', accent('m/cart', '#e0662e'), {
    reviews: [reject('member', 'The badge overlaps the cart icon on small screens.', 15)],
  })
  t.pr(65, 'feat/cart-badge', 62, 'Move the cart badge', 'liam', accent('m/cart', '#d9531e'), {
    reviews: [approve('member', 4)],
    merge: 0.3,
  })
  t.failed(50, 'Emulator failed to start', 'tomas')
  t.pr(
    42,
    'feat/apple-pay',
    63,
    'Apple Pay button',
    'tomas',
    together(buttonLeft('m/checkout', true), cards('m/checkout', 3, 1)),
    {
      reviews: [approve('owner', 25)],
      merge: 1,
    },
  )
  t.pr(30, 'chore/typos', 64, 'Fix typos', 'liam', same)
  t.pr(18, 'feat/account-settings', 65, 'Account settings', 'tomas', cards('m/account', 4, 1), {
    reviews: [reject('liam', 'Keep the logout button at the bottom.', 12)],
  })
  t.main(12, 'Free shipping banner (1)', 'liam', flipCart(0))
  t.main(10, 'Free shipping banner (2)', 'liam', flipCart(1))
  t.main(8, 'Free shipping banner (3)', 'tomas', flipCart(2))
  t.main(6, 'Free shipping banner (4)', 'tomas', flipCart(3))
  t.main(4, 'Free shipping banner (5)', 'liam', flipCart(4))
  t.pr(2, 'feat/search-bar', 66, 'Search bar', 'tomas', cards('m/home', 5, 1), {
    requests: ['member', 'liam'],
  })
  t.partial(0.01, 'Emulator upload cut off', 'tomas')
  t.prAt(9, 'fix/menu-asset', 120, 'Corrupt menu screenshot', 'liam', broken('m/menu'), {})
  mainRun(t, 83, 13, 12, ['tomas', 'liam'])
  fill(t, {
    from: 82,
    to: 0.3,
    count: 22,
    prefix: 'mw',
    first: 100,
    pages: ['m/home', 'm/menu', 'm/cart', 'm/checkout', 'm/account'],
    authors: ['tomas', 'liam', 'member'],
    reviewers: ['member', 'tomas', 'liam'],
    pendingDays: 9,
  })
  return t.steps
}

function storefront(): Step[] {
  const t = timeline(
    'storefront',
    pagesOf('#8a7a2f', [
      'catalog',
      'product',
      'checkout/cart',
      'checkout/payment',
      'checkout/done',
    ]),
  )
  t.main(86, 'First storefront build', 'kwame', same, { reviews: [approve('elena', 2)] })
  t.pr(74, 'feat/product-gallery', 71, 'Product gallery', 'kwame', cards('product', 5, 3), {
    reviews: [approve('elena', 9)],
    merge: 0.5,
  })
  t.pr(
    60,
    'feat/cart-coupons',
    72,
    'Coupon field in the cart',
    'priya',
    cards('checkout/cart', 4, 1),
    {
      reviews: [reject('kwame', 'The coupon field should sit above the totals.', 14)],
    },
  )
  t.pr(
    59,
    'feat/cart-coupons',
    72,
    'Coupon field above the totals',
    'priya',
    cards('checkout/cart', 6, 1),
    {
      reviews: [approve('kwame', 5)],
      merge: 0.4,
    },
  )
  t.failed(38, 'Checkout end-to-end timed out', 'kwame')
  t.pr(25, 'feat/order-summary', 73, 'Order summary', 'member', cards('checkout/done', 3, 1), {
    reviews: [approve('elena', 19)],
    merge: 1,
  })
  t.pr(
    11,
    'feat/wishlist',
    74,
    'Wishlist',
    'kwame',
    addPage({ name: 'wishlist', accent: '#8a7a2f', cards: 4, columns: 4 }),
    {
      requests: ['elena'],
    },
  )
  t.pr(
    3,
    'fix/payment-layout',
    75,
    'Payment layout',
    'priya',
    buttonLeft('checkout/payment', true),
    {},
  )
  mainRun(t, 85, 4, 10, ['kwame', 'elena'])
  fill(t, {
    from: 85,
    to: 0.5,
    count: 18,
    prefix: 'sf',
    first: 100,
    pages: ['catalog', 'product', 'checkout/cart', 'checkout/payment', 'checkout/done'],
    authors: ['kwame', 'priya', 'member'],
    reviewers: ['elena', 'kwame', 'priya'],
  })
  return t.steps
}

function portfolio(): Step[] {
  const t = timeline('portfolio', pagesOf('#7a3a8a', ['home', 'work', 'about', 'contact']))
  t.main(70, 'First portfolio build', 'sofia', same, { reviews: [approve('sofia', 1)] })
  t.pr(45, 'feat/new-project', 81, 'Add the Orbit project', 'tomas', cards('work', 6, 3), {
    reviews: [approve('owner', 12)],
    merge: 1,
  })
  t.pr(16, 'feat/contact-form', 82, 'Contact form', 'sofia', cards('contact', 3, 1), {
    reviews: [reject('owner', 'The submit button is hard to see.', 20)],
  })
  t.pr(
    3,
    'feat/contact-form',
    82,
    'A bolder submit button',
    'sofia',
    together(cards('contact', 3, 1), accent('contact', '#5e2670')),
    {
      requests: ['owner'],
    },
  )
  mainRun(t, 68, 4, 6, ['sofia', 'tomas'])
  fill(t, {
    from: 66,
    to: 0.5,
    count: 12,
    prefix: 'pf',
    first: 100,
    pages: ['home', 'work', 'about', 'contact'],
    authors: ['sofia', 'tomas'],
    reviewers: ['owner', 'sofia', 'tomas'],
  })
  return t.steps
}

/** Nearly every page of a big redesign changes, by a different amount. */
function redesign(screens: Screen[]): Screen[] {
  return screens.map((s, i) => {
    if (!s.name.startsWith('gallery/')) return s
    const k = i % 10
    if (k === 0) return { ...s, band: 0.4 }
    if (k === 1 || k === 2) return { ...s, band: 0.2 }
    if (k >= 3 && k <= 5) return { ...s, band: 0.05 }
    if (k === 6) return { ...s, band: 0.003 }
    if (k === 7 && i < 70) return { ...s, width: 960, height: 640 }
    return s
  })
}

function componentGallery(): Step[] {
  const t = timeline('component-gallery', gallery('gallery', 150, '#2f9e6b'))
  t.main(88, 'Seed the gallery', 'amara', same, { reviews: [approve('sofia', 3)] })
  // 150 screenshots a build: 15 large, 30 medium, 45 small, 15 below the threshold, some bigger.
  const everything = together(
    redesign,
    addPage({ name: 'gallery/151', accent: '#2f9e6b', cards: 3, columns: 3 }),
    addPage({ name: 'gallery/152', accent: '#2f9e6b', cards: 2, columns: 2 }),
    addPage({ name: 'gallery/153', accent: '#2f9e6b', cards: 5, columns: 1 }),
    removePage('gallery/149'),
    removePage('gallery/150'),
  )
  t.pr(60, 'feat/redesign-everything', 201, 'Redesign every component', 'sofia', everything, {
    requests: ['amara', 'priya'],
    reviews: [reject('amara', 'Too much at once: split the redesign by area.', 20)],
    comments: [
      say('amara', 18, 'The first rows are far off from the design.', {
        snapshot: 'gallery/011',
        region: REGION,
      }),
      say('sofia', 19, 'They follow the new tokens. Which part is off?', { reply: true }),
      say('amara', 20, 'The paddings: they should be 24px, not 16px.', { reply: true }),
    ],
    snapshotReviews: [
      {
        by: 'priya',
        decision: 'approved',
        names: Array.from(
          { length: 30 },
          // The small changes: pages 10j+4 and 10j+5.
          (_, i) => `gallery/${String(Math.floor(i / 2) * 10 + 4 + (i % 2)).padStart(3, '0')}`,
        ),
      },
      {
        by: 'amara',
        decision: 'rejected',
        reason: 'The spacing is off.',
        names: ['gallery/011', 'gallery/012', 'gallery/021', 'gallery/022'],
      },
    ],
  })
  t.pr(
    57,
    'feat/redesign-everything',
    201,
    'Redesign every component, spacing fixed',
    'sofia',
    together(everything, band('gallery/011', 0.05), band('gallery/012', 0.05)),
    {
      snapshotReviews: [{ by: 'amara', decision: 'approved', names: 'undecided' }],
      reviews: [approve('amara', 30)],
      merge: 1,
    },
  )
  t.prAt(
    30,
    'fix/ci-no-history',
    202,
    'CI job without git history',
    'priya',
    band('gallery/040', 0.08),
    { noAncestry: true, requests: ['sofia'] },
  )
  t.prAt(11, 'fix/broken-thumb', 203, 'Corrupt screenshot', 'amara', broken('gallery/007'), {})
  mainRun(t, 55, 2, 14, ['amara', 'sofia'])
  fill(t, {
    from: 55,
    to: 0.3,
    count: 16,
    prefix: 'gl',
    first: 210,
    pages: Array.from({ length: 40 }, (_, i) => `gallery/${String(i + 1).padStart(3, '0')}`),
    authors: ['sofia', 'amara', 'priya'],
    reviewers: ['amara', 'priya', 'owner'],
  })
  // The same size again, with nothing decided yet.
  t.prAt(
    1.5,
    'feat/new-theme',
    230,
    'A new theme for all components',
    'amara',
    (screens) =>
      screens.map((s, i) =>
        i % 3 === 0 ? { ...s, background: '#fde7c8' } : i % 3 === 1 ? { ...s, band: 0.18 } : s,
      ),
    { requests: ['sofia', 'priya', 'owner'] },
  )
  return t.steps
}

function adminConsole(): Step[] {
  const t = timeline(
    'admin-console',
    pagesOf('#5b2fd0', [
      'admin/users',
      'admin/billing',
      'admin/roles',
      'admin/audit-log',
      'admin/settings',
      'admin/billing-history',
    ]),
  )
  t.main(86, 'First console build', 'daniel', same, { reviews: [approve('owner', 2)] })
  t.failed(75, 'Run the console tests on the new runner', 'liam')
  t.pr(70, 'feat/roles-page', 301, 'Roles page', 'daniel', cards('admin/roles', 5, 2), {
    reviews: [approve('owner', 10)],
    merge: 0.5,
  })
  t.failed(22, 'Staging deploy timed out', 'daniel')
  t.partial(0.01, 'Upload from a runner that stopped', 'liam')
  t.rerun(69.7, 'feat/roles-page')
  mainRun(t, 84, 2, 18, ['daniel', 'liam'])
  fill(t, {
    from: 84,
    to: 0.3,
    count: 26,
    prefix: 'ad',
    first: 310,
    pages: [
      'admin/users',
      'admin/billing',
      'admin/roles',
      'admin/audit-log',
      'admin/settings',
      'admin/billing-history',
    ],
    authors: ['daniel', 'liam', 'member'],
    reviewers: ['owner', 'daniel', 'member'],
    pendingDays: 8,
  })
  return t.steps
}

/** Every project's builds. The seed reads the project's own list oldest first. */
export const HISTORY: Record<string, Step[]> = {
  'web-app': webApp(),
  'api-server': api(),
  storybook: storybook(),
  'design-system': designSystem(),
  'marketing-site': marketing(),
  'mobile-web': mobileWeb(),
  storefront: storefront(),
  portfolio: portfolio(),
  'component-gallery': componentGallery(),
  'admin-console': adminConsole(),
}

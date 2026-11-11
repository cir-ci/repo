import type { PersonKey } from './config.ts'
import {
  type Change,
  type Screen,
  BASELINE,
  STORYBOOK,
  accent,
  addPage,
  banner,
  buttonLeft,
  cards,
  pagesOf,
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
}

interface Extras {
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
  const push = (step: Omit<Step, 'project' | 'reviews' | 'comments' | 'requests'> & Extras) => {
    const { merge: _merge, ...rest } = step
    steps.push({
      reviews: [],
      comments: [],
      requests: [],
      ...rest,
      project,
    })
  }
  return {
    steps,
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
  return t.steps
}

function api(): Step[] {
  const t = timeline(
    'api',
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
  return t.steps
}

/** Every project's builds. The seed reads the project's own list oldest first. */
export const HISTORY: Record<string, Step[]> = {
  'web-app': webApp(),
  api: api(),
  storybook: storybook(),
  'design-system': designSystem(),
  'marketing-site': marketing(),
  'mobile-web': mobileWeb(),
  storefront: storefront(),
  portfolio: portfolio(),
}

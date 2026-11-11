import { check, sleep } from 'k6'
// Dashboard read API: signed-in GETs of the pages people use, with the number of VUs ramping up.
// The session comes from the real /api/auth sign-in, once in setup(): better-auth rate-limits
// sign-in to a few a minute per address, so 50 VUs signing in would measure the limiter. Every VU
// then sends the one session cookie, which is what a browser tab does on each request.
// Run by `pnpm perf`; by hand:
//   k6 run -e PERF_STATE=perf/.state/seed.json -e PEAK_VUS=50 perf/k6/dashboard.js
import http from 'k6/http'
import { Counter, Rate, Trend } from 'k6/metrics'

const state = JSON.parse(open(__ENV.PERF_STATE))
const PEAK = Number(__ENV.PEAK_VUS || 50)
const RAMP_S = Number(__ENV.RAMP_S || 20)
const HOLD_S = Number(__ENV.HOLD_S || 40)

const ENDPOINTS = [
  'projects',
  'workspace_builds',
  'build_detail',
  'inbox',
  'reviews',
  'triage',
  'baselines',
  'insights_30d',
  'insights_90d',
]
const trends = Object.fromEntries(ENDPOINTS.map((e) => [e, new Trend(`req_${e}`, true)]))
const errors = new Rate('errors')
const requests = new Counter('dashboard_requests')

export const options = {
  scenarios: {
    readers: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: `${RAMP_S}s`, target: Math.max(1, Math.round(PEAK / 2)) },
        { duration: `${RAMP_S}s`, target: PEAK },
        { duration: `${HOLD_S}s`, target: PEAK },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    errors: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
    req_projects: ['p(95)<500'],
    req_workspace_builds: ['p(95)<500'],
    req_build_detail: ['p(95)<500'],
    req_inbox: ['p(95)<500'],
    req_reviews: ['p(95)<500'],
    req_triage: ['p(95)<500'],
    req_baselines: ['p(95)<500'],
    req_insights_30d: ['p(95)<1000'],
    req_insights_90d: ['p(95)<1500'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'max'],
}

export function setup() {
  const signIn = http.post(
    `${state.baseUrl}/api/auth/sign-in/email`,
    JSON.stringify({ email: state.email, password: state.password }),
    { headers: { 'content-type': 'application/json', origin: state.baseUrl } },
  )
  if (signIn.status !== 200) throw new Error(`Sign-in failed: HTTP ${signIn.status} ${signIn.body}`)
  const cookie = Object.values(signIn.cookies)
    .map((c) => `${c[0].name}=${c[0].value}`)
    .join('; ')
  const headers = { cookie }
  const list = http.get(`${state.baseUrl}/api/workspaces/${state.workspace}/builds`, { headers })
  const builds = list.json('builds') || []
  if (builds.length === 0) throw new Error('The workspace has no builds: seed the stack first')
  return { cookie, buildNumber: builds[0].number, buildCount: builds.length }
}

const DAY_MS = 86_400_000

export default function (setupData) {
  const headers = { cookie: setupData.cookie }
  const base = `${state.baseUrl}/api`
  const w = state.workspace
  const p = state.project
  const to = new Date()
  const from90 = new Date(to.getTime() - 90 * DAY_MS)
  const urls = {
    projects: `${base}/projects`,
    workspace_builds: `${base}/workspaces/${w}/builds`,
    build_detail: `${base}/projects/${w}/${p}/builds/${setupData.buildNumber}`,
    inbox: `${base}/inbox`,
    reviews: `${base}/reviews`,
    triage: `${base}/projects/${w}/${p}/triage`,
    baselines: `${base}/projects/${w}/${p}/baselines`,
    insights_30d: `${base}/workspaces/${w}/insights`,
    insights_90d: `${base}/workspaces/${w}/insights?from=${encodeURIComponent(from90.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
  }
  for (const name of ENDPOINTS) {
    const res = http.get(urls[name], { headers, tags: { name } })
    trends[name].add(res.timings.duration)
    requests.add(1)
    const ok = check(res, { [`${name} 200`]: (r) => r.status === 200 })
    errors.add(!ok)
    sleep(0.2 + Math.random() * 0.4)
  }
  sleep(0.5 + Math.random())
}

export function handleSummary(data) {
  const lines = ENDPOINTS.map((e) => {
    const v = data.metrics[`req_${e}`] && data.metrics[`req_${e}`].values
    return v ? `  ${e}: med ${v.med.toFixed(0)} ms  p95 ${v['p(95)'].toFixed(0)} ms` : ''
  })
  return {
    [__ENV.SUMMARY_OUT]: JSON.stringify(data),
    stdout: `dashboard: up to ${PEAK} VUs\n${lines.join('\n')}\n`,
  }
}

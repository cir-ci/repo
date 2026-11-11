import { check, sleep } from 'k6'
import { SharedArray } from 'k6/data'
// Upload pipeline: simulated CI jobs uploading a build the way `@circi/cli`'s `upload` does it.
//   POST /v1/builds -> PUT each file the server asks for (8 at a time, like the CLI) ->
//   POST /v1/builds/:id/finalize -> poll GET /v1/builds/:id/status until the build is processed.
// Run by `pnpm perf` (see perf/README.md); by hand:
//   k6 run -e PERF_STATE=perf/.state/seed.json -e PERF_FIXTURES=perf/fixtures -e VUS=5 -e ITERATIONS=3 perf/k6/upload.js
import encoding from 'k6/encoding'
import exec from 'k6/execution'
import http from 'k6/http'
import { Counter, Rate, Trend } from 'k6/metrics'

const state = JSON.parse(open(__ENV.PERF_STATE))
const fixtures = __ENV.PERF_FIXTURES
// The run's manifest (`--shots` repeats the generated screenshots under new names), else the fixtures'.
const manifest = JSON.parse(open(__ENV.PERF_MANIFEST || `${fixtures}/manifest.json`))

const VUS = Number(__ENV.VUS || 1)
const ITERATIONS = Number(__ENV.ITERATIONS || 3)
const OFFSET = Number(__ENV.OFFSET || 0)
const POLL_MS = Number(__ENV.POLL_MS || 250)
const DONE_TIMEOUT_S = Number(__ENV.DONE_TIMEOUT_S || 300)
const UPLOAD_LANES = 8

// Every distinct file of the manifest, base64 in shared memory (k6 has no shared binary arrays,
// and one copy per VU would multiply 100+ MB by the concurrency).
const fileIndex = []
for (const shot of manifest.shots) for (const v of shot.variants) fileIndex.push(v.file)
const blobs = new SharedArray('png', () =>
  [...new Set(fileIndex)].map((f) => encoding.b64encode(open(`${fixtures}/${f}`, 'b'))),
)
const blobOf = new Map([...new Set(fileIndex)].map((f, i) => [f, i]))

const tCreate = new Trend('req_create_build', true)
const tUpload = new Trend('req_upload_file', true)
const tFinalize = new Trend('req_finalize', true)
const tStatus = new Trend('req_status_poll', true)
const tDone = new Trend('finalize_to_done', true)
const tBuild = new Trend('build_total', true)
const buildsDone = new Counter('builds_done')
const buildsFailed = new Counter('builds_failed')
const shotsTotal = new Counter('screenshots_total')
const shotsDiffed = new Counter('screenshots_diffed')
const uploadedBytes = new Counter('uploaded_bytes')
const errors = new Rate('errors')
// Uploads sent again after a network error or a 5xx, as @circi/cli does (3 attempts, 0.5 s then 1 s
// apart): counted, so a run shows how often the client had to retry.
const uploadRetries = new Counter('upload_retries')
const UPLOAD_ATTEMPTS = 3
// A network error has status 0; it and a 5xx are retried, as the CLI retries them.
const retryable = (r) => r.status === 0 || r.status >= 500

export const options = {
  scenarios: {
    builds: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: ITERATIONS,
      maxDuration: '30m',
    },
  },
  thresholds: {
    errors: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
    // Generous: a build that takes longer than two minutes is a failure of the pipeline.
    finalize_to_done: ['p(95)<120000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'max'],
}

const auth = { authorization: `Bearer ${state.token}` }
const jsonHeaders = { ...auth, 'content-type': 'application/json' }

const randomSha = () => {
  let s = ''
  for (let i = 0; i < 40; i += 1) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

export default function () {
  const n = exec.scenario.iterationInTest
  const variant = (OFFSET + n) % manifest.variantCount
  const shots = manifest.shots.map((s) => ({
    name: s.name,
    file: s.variants[variant % s.variants.length],
  }))
  const unique = [...new Map(shots.map((s) => [s.file.sha256, s.file])).values()]
  const started = Date.now()
  let ok = true

  const created = http.post(
    `${state.baseUrl}/v1/builds`,
    JSON.stringify({
      commitSha: randomSha(),
      branch: `perf/${n}`,
      prNumber: 1000 + n,
      baseBranch: 'main',
      mergeBaseSha: state.baseSha,
      ancestorShas: [state.baseSha],
      ancestryStatus: 'ok',
      author: { login: 'perf-bot' },
      files: unique.map((f) => ({ sha256: f.sha256, size: f.size, contentType: 'image/png' })),
    }),
    { headers: jsonHeaders, tags: { name: 'create_build' } },
  )
  tCreate.add(created.timings.duration)
  if (!check(created, { 'create 201': (r) => r.status === 201 })) {
    errors.add(1)
    buildsFailed.add(1)
    return
  }
  const { build, uploads } = created.json()

  for (let i = 0; i < uploads.length; i += UPLOAD_LANES) {
    const lane = uploads.slice(i, i + UPLOAD_LANES)
    const request = (u) => {
      const file = unique.find((f) => f.sha256 === u.sha256)
      const body = encoding.b64decode(blobs[blobOf.get(file.file)])
      const headers = { ...u.headers }
      delete headers['content-length']
      if (u.auth === 'token') Object.assign(headers, auth)
      return [u.method, u.url, body, { headers, tags: { name: 'upload_file' } }]
    }
    const responses = http.batch(lane.map(request))
    for (let attempt = 1; attempt < UPLOAD_ATTEMPTS; attempt += 1) {
      const again = lane.map((u, j) => j).filter((j) => retryable(responses[j]))
      if (again.length === 0) break
      sleep((250 * 2 ** attempt) / 1000)
      uploadRetries.add(again.length)
      const retried = http.batch(again.map((j) => request(lane[j])))
      again.forEach((j, k) => {
        responses[j] = retried[k]
      })
    }
    lane.forEach((u, j) => {
      tUpload.add(responses[j].timings.duration)
      uploadedBytes.add(unique.find((f) => f.sha256 === u.sha256).size)
      const good = check(responses[j], { 'upload 2xx': (r) => r.status >= 200 && r.status < 300 })
      errors.add(!good)
      ok = ok && good
    })
  }

  const finalized = http.post(
    `${state.baseUrl}/v1/builds/${build.id}/finalize`,
    JSON.stringify({ screenshots: shots.map((s) => ({ name: s.name, sha256: s.file.sha256 })) }),
    { headers: jsonHeaders, tags: { name: 'finalize' } },
  )
  tFinalize.add(finalized.timings.duration)
  const finalizedOk = check(finalized, { 'finalize 200': (r) => r.status === 200 })
  errors.add(!finalizedOk)
  if (!finalizedOk || !ok) {
    buildsFailed.add(1)
    return
  }

  // Polling every POLL_MS (the CLI backs off to 2 s): finer, so the wait is measured, not rounded.
  const finalizedAt = Date.now()
  let status
  for (;;) {
    const res = http.get(`${state.baseUrl}/v1/builds/${build.id}/status`, {
      headers: auth,
      tags: { name: 'status_poll' },
    })
    tStatus.add(res.timings.duration)
    if (res.status === 200) {
      status = res.json()
      if (status.outcome.state !== 'pending') break
    } else {
      errors.add(1)
    }
    if (Date.now() - finalizedAt > DONE_TIMEOUT_S * 1000) {
      errors.add(1)
      buildsFailed.add(1)
      return
    }
    sleep(POLL_MS / 1000)
  }
  tDone.add(Date.now() - finalizedAt)
  tBuild.add(Date.now() - started)
  const processed = check(status, {
    'build processed': (s) => s.build.status !== 'error' && s.counts.failed === 0,
    'all screenshots counted': (s) => s.counts.total === shots.length,
  })
  errors.add(!processed)
  if (!processed) {
    buildsFailed.add(1)
    return
  }
  buildsDone.add(1)
  shotsTotal.add(shots.length)
  shotsDiffed.add(manifest.diffedPerBuild)
}

export function handleSummary(data) {
  const m = data.metrics
  const line = (name, unit) => {
    const v = m[name] && m[name].values
    return v
      ? `  ${name}: med ${v.med.toFixed(0)}${unit}  p95 ${v['p(95)'].toFixed(0)}${unit}  max ${v.max.toFixed(0)}${unit}`
      : ''
  }
  const out = [
    `upload: ${VUS} concurrent builds, ${m.builds_done ? m.builds_done.values.count : 0} done, ${m.builds_failed ? m.builds_failed.values.count : 0} failed`,
    line('finalize_to_done', ' ms'),
    line('req_create_build', ' ms'),
    line('req_upload_file', ' ms'),
    line('req_finalize', ' ms'),
    '',
  ].join('\n')
  return { [__ENV.SUMMARY_OUT]: JSON.stringify(data), stdout: out }
}

#!/usr/bin/env node
// Prints a short-lived (one hour) installation token of the organization's `cir-ci` GitHub App for
// one repository: `node scripts/github-app-token.mjs cir-ci/repo`. The CircleCI `renovate` job runs
// Renovate with it (.circleci/config.yml), so no person's token is involved.
//
// Reads CIRCI_APP_CLIENT_ID (the app's client ID) and CIRCI_APP_PRIVATE_KEY (its private key, the
// PEM as is or base64-encoded, since a CI variable may not keep the newlines). The token gets the
// permissions the app's installation has, for that one repository only.
import { createSign } from 'node:crypto'

const clientId = process.env.CIRCI_APP_CLIENT_ID
const rawKey = process.env.CIRCI_APP_PRIVATE_KEY
const [owner, repo] = (process.argv[2] ?? '').split('/')
if (!clientId || !rawKey) throw new Error('Set CIRCI_APP_CLIENT_ID and CIRCI_APP_PRIVATE_KEY')
if (!owner || !repo) throw new Error('Usage: github-app-token.mjs <owner>/<repo>')
const key = rawKey.includes('-----BEGIN')
  ? rawKey.replaceAll('\\n', '\n')
  : Buffer.from(rawKey, 'base64').toString('utf8')

// The app's own JWT: valid for nine minutes, backdated a minute for clock drift.
const now = Math.floor(Date.now() / 1000)
const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: now - 60, exp: now + 540, iss: clientId })}`
const jwt = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key, 'base64url')}`

async function github(path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${jwt}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) throw new Error(`GitHub ${path}: ${response.status} ${await response.text()}`)
  return response.json()
}

const installation = await github(`/repos/${owner}/${repo}/installation`)
const { token } = await github(`/app/installations/${installation.id}/access_tokens`, {
  method: 'POST',
  body: JSON.stringify({ repositories: [repo] }),
})
process.stdout.write(token)

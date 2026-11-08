import { describe, expect, it } from 'vitest'

import { createTrackerFactory, JiraTracker, LinearTracker, toAdf } from '#src/index.ts'

import { fakeJiraHost, fakeLinearHost } from './support/fake-tracker-hosts.ts'
import { runIssueTrackerContract, type TrackerHarness } from './support/tracker-contract.ts'

const teams = [
  { id: 'team-1', key: 'ENG', name: 'Engineering' },
  { id: 'team-2', key: 'WEB', name: 'Web' },
]

function linearHarness(): TrackerHarness {
  const fake = fakeLinearHost({
    apiKey: 'lin_api_ok',
    organization: { id: 'org-1', name: 'Acme' },
    teams,
  })
  return {
    tracker: new LinearTracker({ apiKey: 'lin_api_ok', fetch: fake.fetcher }),
    rejected: new LinearTracker({ apiKey: 'nope', fetch: fake.fetcher }),
    account: { externalId: 'org-1', name: 'Acme' },
    targets: teams.map((t) => ({ ref: t.id, name: `${t.name} (${t.key})` })),
    host: fake.host,
  }
}

const projects = [
  { key: 'WEB', name: 'Website' },
  { key: 'APP', name: 'Mobile app' },
]
const basic = `Basic ${Buffer.from('ann@acme.test:tok').toString('base64')}`

function jiraHarness(): TrackerHarness {
  const fake = fakeJiraHost({ authorization: basic, projects })
  const site = 'https://acme.atlassian.net'
  return {
    tracker: new JiraTracker({
      siteUrl: site,
      email: 'ann@acme.test',
      apiToken: 'tok',
      fetch: fake.fetcher,
    }),
    rejected: new JiraTracker({
      siteUrl: site,
      email: 'ann@acme.test',
      apiToken: 'wrong',
      fetch: fake.fetcher,
    }),
    account: { externalId: 'acme.atlassian.net', name: 'acme.atlassian.net' },
    targets: projects.map((p) => ({
      ref: p.key,
      name: `${p.name} (${p.key})`,
    })),
    host: fake.host,
  }
}

runIssueTrackerContract('Linear', linearHarness)
runIssueTrackerContract('Jira', jiraHarness)

describe('Linear', () => {
  it('attaches the diff link to the issue', async () => {
    const fake = fakeLinearHost({
      apiKey: 'k',
      organization: { id: 'o', name: 'Acme' },
      teams,
    })
    const tracker = new LinearTracker({ apiKey: 'k', fetch: fake.fetcher })
    await tracker.createIssue({
      target: 'team-1',
      title: 't',
      description: 'd',
      imageUrl: 'https://ci.test/diff',
    })
    expect(fake.host.attachments()).toEqual([{ issueId: 'lin-ENG-1', url: 'https://ci.test/diff' }])
  })
})

describe('Jira', () => {
  it('accepts an OAuth token and opens issues on the site address', async () => {
    const fake = fakeJiraHost({
      authorization: 'Bearer oauth-token',
      projects,
    })
    const tracker = new JiraTracker({
      siteUrl: 'https://api.atlassian.com/ex/jira/cloud-id',
      browseUrl: 'https://acme.atlassian.net',
      accessToken: 'oauth-token',
      fetch: fake.fetcher,
    })
    const issue = await tracker.createIssue({
      target: 'WEB',
      title: 't',
      description: 'd',
    })
    expect(issue.url).toBe('https://acme.atlassian.net/browse/WEB-1')
  })

  it('writes the description as an Atlassian document with links', () => {
    const doc = toAdf('one\n\ntwo https://x.test/y', 'https://x.test/diff')
    expect(doc.type).toBe('doc')
    expect(doc.content).toHaveLength(3)
    expect(JSON.stringify(doc)).toContain('"type":"link"')
  })
})

describe('createTrackerFactory', () => {
  const factory = createTrackerFactory()
  it('builds the adapter for stored credentials', () => {
    expect(factory('linear', JSON.stringify({ apiKey: 'k' }))?.kind).toBe('linear')
    expect(
      factory(
        'jira',
        JSON.stringify({
          siteUrl: 'https://a.test',
          email: 'e',
          apiToken: 't',
        }),
      )?.kind,
    ).toBe('jira')
    expect(
      factory('jira', JSON.stringify({ siteUrl: 'https://a.test', accessToken: 't' }))?.kind,
    ).toBe('jira')
  })
  it('returns nothing for other kinds and unreadable credentials', () => {
    expect(factory('slack', '{}')).toBeUndefined()
    expect(factory('linear', 'not json')).toBeUndefined()
    expect(factory('jira', '{"siteUrl":"https://a.test"}')).toBeUndefined()
  })
})

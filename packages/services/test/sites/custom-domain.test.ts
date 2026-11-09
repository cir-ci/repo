import { ConflictError, NotFoundError, ValidationError } from '@circi/core'
import {
  findSiteByAddress,
  findSiteByCustomDomain,
  isVerifiedCustomDomain,
} from '@circi/db/queries'
import { GIT_NOTIFY_QUEUE } from '@circi/db/queue'
import * as schema from '@circi/db/schema'
import {
  createTestDb,
  seedBuild,
  seedGitLink,
  seedSession,
  seedTeam,
  seedUser,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  clearCustomDomain,
  confirmSiteSession,
  handOffToSite,
  openSiteSession,
  publishSite,
  setCustomDomain,
  type SiteDnsResolver,
  verifyCustomDomain,
} from '#src/index.ts'

/** DNS is faked: the real resolver needs the network. */

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.reset()
})

const hosts = { dashboardHost: 'ci.acme.io', sitesHost: 'acme-sites.com' }
const COMMIT = 'abcdef012345'

let slugs = 0
const addressingFor = (commitSha: string) => ({
  chooseSlug: () => `acme${(slugs += 1)}`,
  commitLabel: (slug: string) => `${commitSha.slice(0, 12)}-${slug}`,
  branchLabel: (branch: string, slug: string) => `${branch}hash-${slug}`,
})
const files = [{ path: 'index.html', sha256: fakeSha('a'), size: 3, contentType: 'text/html' }]

function publish(teamId: string, over: Partial<publishSite.Input> = {}) {
  return publishSite(t.db, {
    teamId,
    name: 'storybook',
    kind: 'storybook',
    spa: false,
    commitSha: COMMIT,
    entryPath: 'index.html',
    files,
    storageKeys: new Map([[fakeSha('a'), 'k/a']]),
    fallbackKey: (s) => `fallback/${s}`,
    slugPrefix: 'acme',
    ...over,
    addressing: addressingFor(over.commitSha ?? COMMIT),
  })
}

/** A fake DNS zone: CNAME and address records by name. */
const dns = (zone: { cname?: Record<string, string>; a?: Record<string, string[]> }) => {
  const resolver: SiteDnsResolver = {
    cname: async (host) => (zone.cname?.[host] ? [zone.cname[host]] : []),
    address: async (host) => zone.a?.[host] ?? [],
  }
  return resolver
}

async function siteWithDomain(domain = 'storybook.acme.com') {
  const { team, owner } = await seedTeam(t.db)
  const first = await publish(team.id, { branch: 'main', branchTip: COMMIT })
  await setCustomDomain(t.db, { teamId: team.id, slug: first.site.slug, domain, hosts })
  return { team, owner, slug: first.site.slug, domain, first }
}

describe('setCustomDomain', () => {
  it('normalizes the domain, starts it unverified and keeps it unique across teams', async () => {
    const { team } = await seedTeam(t.db)
    const { site } = await publish(team.id)
    const set = await setCustomDomain(t.db, {
      teamId: team.id,
      slug: site.slug,
      domain: ' Storybook.ACME.com ',
      hosts,
    })
    expect(set).toEqual({ domain: 'storybook.acme.com', verifiedAt: null })

    const other = await seedTeam(t.db)
    const theirs = await publish(other.team.id, { name: 'docs', kind: 'generic' })
    await expect(
      setCustomDomain(t.db, {
        teamId: other.team.id,
        slug: theirs.site.slug,
        domain: 'storybook.acme.com',
        hosts,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('refuses the dashboard host, the sites domain and bad names, with the reason', async () => {
    const { team } = await seedTeam(t.db)
    const { site } = await publish(team.id)
    const set = (domain: string) =>
      setCustomDomain(t.db, { teamId: team.id, slug: site.slug, domain, hosts })
    await expect(set('ci.acme.io')).rejects.toThrow(/dashboard host/)
    await expect(set('storybook.acme.io')).rejects.toThrow(/parent domain/)
    await expect(set('x.acme-sites.com')).rejects.toThrow(/sites domain/)
    await expect(set('https://a.example.com')).rejects.toBeInstanceOf(ValidationError)
  })

  it("is not found for another team's site", async () => {
    const { team } = await seedTeam(t.db)
    const other = await seedTeam(t.db)
    const { site } = await publish(team.id)
    await expect(
      setCustomDomain(t.db, {
        teamId: other.team.id,
        slug: site.slug,
        domain: 'a.example.com',
        hosts,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('keeps the verification when the same domain is saved again, and loses it for a new one', async () => {
    const { team, slug } = await siteWithDomain()
    await verifyCustomDomain(t.db, {
      teamId: team.id,
      slug,
      hosts,
      resolver: dns({ cname: { 'storybook.acme.com': 'custom.acme-sites.com' } }),
    })
    const again = await setCustomDomain(t.db, {
      teamId: team.id,
      slug,
      domain: 'STORYBOOK.acme.com',
      hosts,
    })
    expect(again.verifiedAt).not.toBeNull()
    const changed = await setCustomDomain(t.db, {
      teamId: team.id,
      slug,
      domain: 'stories.acme.com',
      hosts,
    })
    expect(changed.verifiedAt).toBeNull()
    expect(await isVerifiedCustomDomain(t.db, 'storybook.acme.com')).toBe(false)
  })

  it('clearing releases the domain for another site', async () => {
    const { team, slug } = await siteWithDomain()
    await clearCustomDomain(t.db, { teamId: team.id, slug })
    const other = await seedTeam(t.db)
    const theirs = await publish(other.team.id, { name: 'docs', kind: 'generic' })
    await expect(
      setCustomDomain(t.db, {
        teamId: other.team.id,
        slug: theirs.site.slug,
        domain: 'storybook.acme.com',
        hosts,
      }),
    ).resolves.toBeDefined()
    await expect(clearCustomDomain(t.db, { teamId: team.id, slug: 'nope' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

const check = (teamId: string, slug: string, resolver: SiteDnsResolver) =>
  verifyCustomDomain(t.db, { teamId, slug, hosts, resolver })

describe('verifyCustomDomain', () => {
  it('verifies a CNAME to the sites domain (also through a chain) or to the dashboard host', async () => {
    const { team, slug } = await siteWithDomain()
    expect(
      await check(team.id, slug, dns({ cname: { 'storybook.acme.com': 'custom.acme-sites.com' } })),
    ).toMatchObject({ verified: true })
    expect(await isVerifiedCustomDomain(t.db, 'storybook.acme.com')).toBe(true)
    expect(
      await check(
        team.id,
        slug,
        dns({ cname: { 'storybook.acme.com': 'proxy.cdn.net', 'proxy.cdn.net': 'ci.acme.io' } }),
      ),
    ).toMatchObject({ verified: true })
  })

  it('verifies address records that match the server', async () => {
    const { team, slug } = await siteWithDomain()
    const res = await check(
      team.id,
      slug,
      dns({
        a: { 'storybook.acme.com': ['203.0.113.7'], 'custom.acme-sites.com': ['203.0.113.7'] },
      }),
    )
    expect(res.verified).toBe(true)
  })

  it('says what is wrong, and un-verifies a domain that stopped pointing here', async () => {
    const { team, slug } = await siteWithDomain()
    const none = await check(team.id, slug, dns({}))
    expect(none).toMatchObject({ verified: false })
    expect(none.error).toMatch(/CNAME to custom\.acme-sites\.com/)
    const elsewhere = await check(
      team.id,
      slug,
      dns({ cname: { 'storybook.acme.com': 'example.herokudns.com' } }),
    )
    expect(elsewhere.error).toMatch(/points at example\.herokudns\.com, not at this server/)
    const wrongIp = await check(
      team.id,
      slug,
      dns({
        a: { 'storybook.acme.com': ['198.51.100.1'], 'custom.acme-sites.com': ['203.0.113.7'] },
      }),
    )
    expect(wrongIp.error).toMatch(/resolves to 198\.51\.100\.1/)

    await check(team.id, slug, dns({ cname: { 'storybook.acme.com': 'custom.acme-sites.com' } }))
    expect(await isVerifiedCustomDomain(t.db, 'storybook.acme.com')).toBe(true)
    await check(team.id, slug, dns({}))
    expect(await isVerifiedCustomDomain(t.db, 'storybook.acme.com')).toBe(false)
  })

  it('reports a failed lookup and leaves the recorded state alone', async () => {
    const { team, slug } = await siteWithDomain()
    await check(team.id, slug, dns({ cname: { 'storybook.acme.com': 'custom.acme-sites.com' } }))
    const broken: SiteDnsResolver = {
      cname: async () => {
        throw new Error('timeout')
      },
      address: async () => [],
    }
    const res = await check(team.id, slug, broken)
    expect(res).toMatchObject({
      verified: true,
      error: expect.stringContaining('DNS lookup failed'),
    })
    expect(await isVerifiedCustomDomain(t.db, 'storybook.acme.com')).toBe(true)
  })

  it('needs a domain to check', async () => {
    const { team } = await seedTeam(t.db)
    const { site } = await publish(team.id)
    await expect(check(team.id, site.slug, dns({}))).rejects.toBeInstanceOf(ValidationError)
  })
})

const verified = (teamId: string, slug: string) =>
  check(teamId, slug, dns({ cname: { 'storybook.acme.com': 'custom.acme-sites.com' } }))

describe('serving a custom domain', () => {
  it("resolves to the default branch's version, and follows it when the branch moves", async () => {
    const { team, slug, first } = await siteWithDomain()
    expect(await findSiteByCustomDomain(t.db, 'storybook.acme.com')).toBeUndefined() // unverified
    await verified(team.id, slug)
    const found = await findSiteByCustomDomain(t.db, 'storybook.acme.com')
    expect(found).toMatchObject({
      label: 'storybook.acme.com',
      linkKind: 'branch',
      versionId: first.version.id,
      site: { slug },
      team: { id: team.id },
    })
    const second = await publish(team.id, {
      commitSha: 'b'.repeat(12),
      branch: 'main',
      branchTip: 'b'.repeat(12),
    })
    expect((await findSiteByCustomDomain(t.db, 'storybook.acme.com'))?.versionId).toBe(
      second.version.id,
    )
    // A feature branch upload does not move it.
    await publish(team.id, {
      commitSha: 'c'.repeat(12),
      branch: 'feature',
      branchTip: 'c'.repeat(12),
    })
    expect((await findSiteByCustomDomain(t.db, 'storybook.acme.com'))?.versionId).toBe(
      second.version.id,
    )
  })

  it("uses the team's default branch setting, and has nothing before that branch has an upload", async () => {
    const { team, slug } = await siteWithDomain()
    await verified(team.id, slug)
    await t.db
      .update(schema.teams)
      .set({ defaultBranch: 'develop' })
      .where(eq(schema.teams.id, team.id))
    expect(await findSiteByCustomDomain(t.db, 'storybook.acme.com')).toBeUndefined()
    // It is still a verified domain (a certificate may be issued), it just serves nothing yet.
    expect(await isVerifiedCustomDomain(t.db, 'storybook.acme.com')).toBe(true)
    await publish(team.id, {
      commitSha: 'd'.repeat(12),
      branch: 'develop',
      branchTip: 'd'.repeat(12),
    })
    expect(await findSiteByCustomDomain(t.db, 'storybook.acme.com')).toBeDefined()
  })

  it('finds an address by label or by domain', async () => {
    const { team, slug, first } = await siteWithDomain()
    await verified(team.id, slug)
    expect((await findSiteByAddress(t.db, first.commitLabel))?.versionId).toBe(first.version.id)
    expect((await findSiteByAddress(t.db, 'Storybook.acme.com'))?.versionId).toBe(first.version.id)
    expect(await findSiteByAddress(t.db, 'other.example.com')).toBeUndefined()
  })

  it('hands a member a token bound to the domain, which opens a session for that domain only', async () => {
    const { team, owner, slug } = await siteWithDomain()
    await verified(team.id, slug)
    const session = await seedSession(t.db, owner.id)
    const domain = 'storybook.acme.com'
    const token = await handOffToSite(t.db, {
      label: domain,
      userId: owner.id,
      sessionId: session.id,
      method: 'password',
    })
    expect(token).toBeDefined()
    // The token is no good for another address.
    expect(
      await openSiteSession(t.db, {
        token: token ?? null,
        label: 'other.example.com',
        siteExists: true,
      }),
    ).toBeUndefined()
    // Asking for the wrong address spends nothing; the right one then works, once.
    const opened = await openSiteSession(t.db, {
      token: token ?? null,
      label: domain,
      siteExists: true,
    })
    expect(opened).toBeDefined()
    expect(
      await openSiteSession(t.db, { token: token ?? null, label: domain, siteExists: true }),
    ).toBeUndefined()
    expect(
      await confirmSiteSession(t.db, {
        id: opened ?? '',
        label: domain,
        workspaceId: team.workspaceId,
      }),
    ).toBe(true)
    expect(
      await confirmSiteSession(t.db, {
        id: opened ?? '',
        label: 'other.example.com',
        workspaceId: team.workspaceId,
      }),
    ).toBe(false)

    // Outsiders, unverified domains and domains with no upload get nothing, all the same.
    const outsider = await seedUser(t.db)
    const theirs = await seedSession(t.db, outsider.id)
    const ask = (label: string, userId = outsider.id, sessionId = theirs.id) =>
      handOffToSite(t.db, { label, userId, sessionId, method: 'password' })
    expect(await ask(domain)).toBeUndefined()
    expect(await ask('nothing.example.com', owner.id, session.id)).toBeUndefined()
    await t.db
      .update(schema.teamSites)
      .set({ customDomainVerifiedAt: null })
      .where(eq(schema.teamSites.slug, slug))
    expect(await ask(domain, owner.id, session.id)).toBeUndefined()
  })
})

const byText = (a: unknown, b: unknown) => String(a).localeCompare(String(b))
const notices = () => t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, GIT_NOTIFY_QUEUE))

describe('refreshing pull request comments when a site is uploaded', () => {
  it('queues one git-notify per pull request of the commit, in the same flow as builds', async () => {
    const { team } = await seedTeam(t.db)
    await seedGitLink(t.db, team.id, { externalId: '99', repoRef: 'acme/web' })
    const pr5 = await seedBuild(t.db, team.id, {
      commitSha: COMMIT,
      prNumber: 5,
      status: 'complete',
    })
    const pr5again = await seedBuild(t.db, team.id, {
      commitSha: COMMIT,
      prNumber: 5,
      name: 'second',
      status: 'complete',
    })
    const pr6 = await seedBuild(t.db, team.id, {
      commitSha: COMMIT,
      prNumber: 6,
      status: 'complete',
    })
    await seedBuild(t.db, team.id, { commitSha: 'f'.repeat(12), prNumber: 7, status: 'complete' })
    await seedBuild(t.db, team.id, { commitSha: COMMIT, status: 'complete' }) // no pull request
    await t.db.delete(schema.jobs)

    await publish(team.id)
    const ids = (await notices()).map((j) => j.payload.buildId).toSorted(byText)
    expect(ids).toEqual([pr5again.id, pr6.id].toSorted(byText))
    expect(ids).not.toContain(pr5.id)

    // A second upload (a CI re-run) while the first notice is still pending is one notice.
    await publish(team.id)
    expect((await notices()).length).toBeGreaterThanOrEqual(2)
  })

  it('matches a build with an abbreviated SHA, and does nothing for a team without a git link', async () => {
    const { team } = await seedTeam(t.db)
    await seedBuild(t.db, team.id, {
      commitSha: COMMIT.slice(0, 7),
      prNumber: 3,
      status: 'complete',
    })
    await t.db.delete(schema.jobs)
    await publish(team.id)
    expect(await notices()).toHaveLength(0) // not linked to a repository

    await seedGitLink(t.db, team.id, { externalId: '99', repoRef: 'acme/web' })
    await publish(team.id)
    expect(await notices()).toHaveLength(1)
  })
})

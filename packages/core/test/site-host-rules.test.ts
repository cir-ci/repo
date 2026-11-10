import { describe, expect, it } from 'vitest'

import { customDomainProblem, normalizeCustomDomain, staticSitesHostProblem } from '#src/index.ts'

const hosts = { dashboardHost: 'ci.acme.io', sitesHost: 'acme-sites.com' }

describe('normalizeCustomDomain', () => {
  it('lowercases, trims and drops a trailing dot', () => {
    expect(normalizeCustomDomain('  Storybook.ACME.com. ')).toBe('storybook.acme.com')
  })
})

describe('customDomainProblem', () => {
  it('accepts an unrelated domain', () => {
    expect(customDomainProblem('storybook.acme.com', hosts)).toBeUndefined()
    expect(customDomainProblem('xn--bcher-kva.example.org', hosts)).toBeUndefined()
  })

  it.each([
    'https://storybook.acme.com',
    'storybook.acme.com:8080',
    'storybook.acme.com/path',
    '*.acme.com',
    '192.168.0.1',
    'localhost',
    'single',
    'under_score.acme.com',
    '-bad.acme.com',
  ])('refuses %s: not a plain domain name', (domain) => {
    expect(customDomainProblem(domain, hosts)).toMatch(/isn't a domain name/)
  })

  it('refuses the dashboard host, its parent, its children and its siblings (cookie scope)', () => {
    expect(customDomainProblem('ci.acme.io', hosts)).toMatch(/must differ from the dashboard host/)
    expect(customDomainProblem('acme.io', hosts)).toMatch(/parent of the dashboard host/)
    expect(customDomainProblem('x.ci.acme.io', hosts)).toMatch(/below the dashboard host/)
    expect(customDomainProblem('storybook.acme.io', hosts)).toMatch(/shares the parent domain/)
  })

  it('refuses the sites domain, anything below it and any parent of it', () => {
    expect(customDomainProblem('acme-sites.com', hosts)).toMatch(/sites domain/)
    expect(customDomainProblem('x.acme-sites.com', hosts)).toMatch(/sites domain/)
    expect(customDomainProblem('com', hosts)).toMatch(/isn't a domain name/)
    expect(
      customDomainProblem('acme-sites.com', { ...hosts, sitesHost: 's.acme-sites.com' }),
    ).toMatch(/parent of the sites domain/)
  })

  it('applies the same relation rules as the sites domain itself', () => {
    for (const domain of ['ci.acme.io', 'acme.io', 'x.ci.acme.io', 'sites.acme.io']) {
      expect(staticSitesHostProblem(domain, 'ci.acme.io')).toBeDefined()
      expect(customDomainProblem(domain, hosts)).toBeDefined()
    }
  })
})

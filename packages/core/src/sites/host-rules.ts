const parentDomain = (h: string) => h.split('.').slice(1).join('.')

const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/**
 * Why `host` can't share a cookie scope with the dashboard, or undefined. Uploaded sites run
 * arbitrary JavaScript, so their domain has to be unrelated to the dashboard's (not the same
 * host, not a parent of it, not a child of it, not a sibling under one parent domain).
 */
function dashboardRelationProblem(host: string, dashboardHostname: string): string | undefined {
  const dash = dashboardHostname.toLowerCase()
  if (dash === host)
    return 'must differ from the dashboard host: sites run uploaded code and must not share its cookies'
  if (dash.endsWith(`.${host}`))
    return `is a parent of the dashboard host ${dash}: use a separate domain`
  if (host.endsWith(`.${dash}`)) return `is below the dashboard host ${dash}: use a separate domain`
  // Siblings under one parent domain (ci.acme.io and sites.acme.io) can set cookies on acme.io.
  if (parentDomain(dash).includes('.') && parentDomain(dash) === parentDomain(host)) {
    return `shares the parent domain ${parentDomain(dash)} with the dashboard: a site could set cookies for both. Use a different registrable domain`
  }
  return undefined
}

/**
 * Why `host` can't be the sites domain, or undefined. The domain has to be unrelated to the
 * dashboard's (see `dashboardRelationProblem`).
 */
export function staticSitesHostProblem(
  host: string,
  dashboardHostname: string | undefined,
): string | undefined {
  if (!DOMAIN.test(host)) {
    return `"${host}" isn't a domain name (expected e.g. example-sites.com, without https:// or a port)`
  }
  return dashboardHostname ? dashboardRelationProblem(host, dashboardHostname) : undefined
}

/** Lowercases and trims a typed domain; a trailing dot is dropped. Nothing else is accepted. */
export function normalizeCustomDomain(input: string): string {
  return input.trim().toLowerCase().replace(/\.$/, '')
}

/**
 * Why `domain` (already normalized) can't be a project site's custom domain, or undefined. It
 * must be a plain host name (no scheme, port, path, wildcard or IP address), unrelated to the
 * dashboard (the same cookie rules as the sites domain) and outside the sites domain, which
 * belongs to CirCI's own addresses: not the domain itself, not below it, not a parent of it.
 */
export function customDomainProblem(
  domain: string,
  hosts: { dashboardHost: string | undefined; sitesHost: string },
): string | undefined {
  if (!DOMAIN.test(domain)) {
    return `"${domain}" isn't a domain name (expected e.g. storybook.example.com, without https://, a port or a wildcard)`
  }
  const sites = hosts.sitesHost.toLowerCase()
  if (domain === sites || domain.endsWith(`.${sites}`)) {
    return `${domain} is the sites domain ${sites} or below it: those addresses belong to CirCI`
  }
  if (sites.endsWith(`.${domain}`)) {
    return `${domain} is a parent of the sites domain ${sites}: use a separate domain`
  }
  const dash = hosts.dashboardHost
    ? dashboardRelationProblem(domain, hosts.dashboardHost)
    : undefined
  return dash ? `${domain} ${dash}` : undefined
}

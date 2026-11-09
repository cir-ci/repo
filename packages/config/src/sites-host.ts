const parentDomain = (h: string) => h.split('.').slice(1).join('.')

/**
 * Why `host` can't be the sites domain, or undefined. Uploaded sites run arbitrary JavaScript, so
 * they must not share a cookie scope with the dashboard: the domain has to be unrelated to it
 * (not the same host, not a parent of it, not a child of it).
 */
export function staticSitesHostProblem(
  host: string,
  dashboardHostname: string | undefined,
): string | undefined {
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
    return `"${host}" is not a domain name (expected e.g. example-sites.com, without https:// or a port)`
  }
  if (!dashboardHostname) return undefined
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

import type { NavigateOptions } from '@tanstack/react-router'

/**
 * Where a baseline's page is. The name is the route's splat (names contain "/"): the router
 * encodes everything else in it, and the page reads it back decoded.
 */
export function baselineLink(workspace: string, team: string, name: string): NavigateOptions {
  return { to: '/$workspace/$team/baselines/$', params: { workspace, team, _splat: name } }
}

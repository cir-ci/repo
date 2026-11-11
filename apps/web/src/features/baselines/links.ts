import type { NavigateOptions } from '@tanstack/react-router'

/**
 * Where a baseline's page is. The name is the route's splat (names contain "/"): the router
 * encodes everything else in it, and the page reads it back decoded.
 */
export function baselineLink(workspace: string, project: string, name: string): NavigateOptions {
  return { to: '/$workspace/$project/baselines/$', params: { workspace, project, _splat: name } }
}

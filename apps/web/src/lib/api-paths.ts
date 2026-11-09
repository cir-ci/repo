/** Builders for the dashboard API's URLs: every segment is escaped, none can be forgotten. */

import { seg } from '#lib/http.ts'

/** A fixed word of the path (`'builds'`) or a value (`id`, a build number); values are escaped. */
type Segment = string | number

const join = (base: string, rest: readonly Segment[]) =>
  rest.reduce<string>((path, part) => `${path}/${seg(String(part))}`, base)

/** `/api/teams/:workspace/:team/...rest`. A query string is appended by the caller. */
export const teamPath = (workspace: string, team: string, ...rest: Segment[]) =>
  join(`/api/teams/${seg(workspace)}/${seg(team)}`, rest)

/** `/api/workspaces/:workspace/...rest`. A query string is appended by the caller. */
export const workspacePath = (workspace: string, ...rest: Segment[]) =>
  join(`/api/workspaces/${seg(workspace)}`, rest)

/** `/api/instance/...rest`, the instance admin endpoints. */
export const instancePath = (...rest: Segment[]) => join('/api/instance', rest)

/** `/api/inbox/...rest`, the signed-in user's Inbox. */
export const inboxPath = (...rest: Segment[]) => join('/api/inbox', rest)

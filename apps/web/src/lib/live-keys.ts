import type { Live } from '@circi/api'

import { keys } from '#lib/query-keys.ts'

type Key = readonly unknown[]

/**
 * Which queries an event makes stale: the keys (prefixes) to invalidate. Only the queries on
 * screen refetch; the rest are marked stale and refetch when next shown. A change can reach
 * further than its name says (a decision closes review requests and clears inbox notices; a
 * finished build moves triage), so the lists that show the same facts go with it.
 *
 * An event that lacks the slugs its type should carry (a newer server) falls back to the whole
 * family, never to nothing.
 */
export function liveInvalidations(event: Live.Event): Key[] {
  const { workspace, project, build } = event
  const inProject = workspace !== undefined && project !== undefined
  switch (event.type) {
    case 'build.created':
    case 'build.finalized':
    case 'build.updated':
      return inProject
        ? [
            keys.project(workspace, project),
            keys.workspaceBuilds(workspace),
            ...(build === undefined
              ? [keys.projectBuildPages(workspace, project)]
              : [
                  keys.build(workspace, project, build),
                  keys.activity(workspace, project, build),
                  keys.issues(workspace, project, build),
                ]),
            keys.flaky(workspace, project),
            keys.triage(workspace, project),
            keys.reviews(),
            keys.inbox(),
            keys.sidebar(workspace),
          ]
        : [
            ['project'],
            ['workspace-builds'],
            ['build'],
            keys.triage(),
            keys.reviews(),
            keys.sidebar(),
          ]
    case 'review.changed':
      return inProject
        ? [
            build === undefined
              ? keys.projectBuildPages(workspace, project)
              : keys.build(workspace, project, build),
            ...(build === undefined ? [] : [keys.activity(workspace, project, build)]),
            keys.project(workspace, project),
            keys.workspaceBuilds(workspace),
            keys.triage(workspace, project),
            keys.reviews(),
            keys.inbox(),
            keys.sidebar(workspace),
          ]
        : [
            ['build'],
            ['project'],
            ['workspace-builds'],
            keys.reviews(),
            keys.inbox(),
            keys.sidebar(),
          ]
    case 'comment.changed':
      return inProject && build !== undefined
        ? [
            keys.comments(workspace, project, build),
            keys.activity(workspace, project, build),
            keys.build(workspace, project, build),
          ]
        : [['comments'], ['activity'], ['build']]
    case 'notification.created':
    case 'notification.read':
      return [keys.inbox(), keys.sidebar()]
    case 'triage.changed':
      return inProject
        ? [
            keys.triage(workspace, project),
            keys.ignoreRegions(workspace, project),
            keys.sidebar(workspace),
          ]
        : [keys.triage(), ['ignore-regions'], keys.sidebar()]
    default:
      // `resync`: everything on screen (what isn't is only marked stale). Also what an unknown type means.
      return [[]]
  }
}

/** Reads one message of the stream; undefined for anything that is not an event (a newer server's, or garbage). */
export function parseLiveEvent(data: unknown): Live.Event | undefined {
  if (typeof data !== 'string') return undefined
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const type: unknown = Reflect.get(raw, 'type')
  const known = EVENT_TYPES.find((t) => t === type)
  if (known === undefined) return undefined
  const workspace: unknown = Reflect.get(raw, 'workspace')
  const project: unknown = Reflect.get(raw, 'project')
  const build: unknown = Reflect.get(raw, 'build')
  return {
    type: known,
    ...(typeof workspace === 'string' ? { workspace } : {}),
    ...(typeof project === 'string' ? { project } : {}),
    ...(typeof build === 'number' ? { build } : {}),
  }
}

const EVENT_TYPES = [
  'build.created',
  'build.finalized',
  'build.updated',
  'review.changed',
  'comment.changed',
  'notification.created',
  'notification.read',
  'triage.changed',
  'resync',
] as const satisfies readonly Live.EventType[]

import type { Live } from '@circi/api'
import type { LiveNotice } from '@circi/core'
import { decodeLiveNotice } from '@circi/core'
import type { ListenFn } from '@circi/db'
import type { getLiveScope } from '@circi/db/queries'
import { type Actor, canSeeProject, LIVE_CHANNEL } from '@circi/services'

/**
 * Live updates, server side. One LISTEN on `circi_live` per server process (every instance hears
 * every change, whichever process made it); each open dashboard connection is a subscriber that
 * filters what it hears down to what its person may see.
 */

export interface LiveSubscriber {
  /** A notice from the channel. Called for every notice, whoever it concerns: the subscriber filters. */
  notice(notice: LiveNotice): void
  /** The feed is gone (the LISTEN connection dropped, or the server is closing): end the stream; the client reconnects. */
  end(): void
}

export interface LiveHub {
  /** Whether the feed is up, trying to start it when it is not. A stream opened while it is down would never hear anything. */
  ready(): Promise<boolean>
  /** Whether the feed is up now. */
  up(): boolean
  /** How many subscribers are listening now (tests and the stream caps). */
  subscribers(): number
  /** Starts delivering notices; returns the way out. */
  subscribe(subscriber: LiveSubscriber): () => void
  /** Ends every subscriber and stops listening. */
  close(): Promise<void>
}

export function createLiveHub(options: {
  listen: ListenFn
  logger: { warn(obj: unknown, msg: string): void }
}): LiveHub {
  const subscribers = new Set<LiveSubscriber>()
  let stop: (() => Promise<void>) | undefined
  let starting: Promise<boolean> | undefined
  let closed = false

  const onPayload = (payload: string): void => {
    const notice = decodeLiveNotice(payload)
    if (!notice) return
    for (const subscriber of subscribers) {
      try {
        subscriber.notice(notice)
      } catch (err) {
        options.logger.warn({ err }, 'a live subscriber failed on a notice')
      }
    }
  }

  const endAll = (): void => {
    const ending = [...subscribers]
    subscribers.clear()
    for (const subscriber of ending) subscriber.end()
  }

  const onLost = (err: Error): void => {
    stop = undefined
    options.logger.warn({ err }, 'lost the live update connection; open streams are closed')
    endAll()
  }

  const start = (): Promise<boolean> => {
    starting ??= options
      .listen(LIVE_CHANNEL, onPayload, onLost)
      .then(
        async (unlisten) => {
          if (closed) {
            await unlisten().catch(() => {})
            return false
          }
          stop = unlisten
          return true
        },
        (err: unknown) => {
          options.logger.warn({ err }, 'could not listen for live updates')
          return false
        },
      )
      .finally(() => {
        starting = undefined
      })
    return starting
  }

  return {
    ready: () => (stop ? Promise.resolve(true) : start()),
    up: () => stop !== undefined,
    subscribers: () => subscribers.size,
    subscribe(subscriber) {
      subscribers.add(subscriber)
      return () => {
        subscribers.delete(subscriber)
      }
    },
    async close() {
      closed = true
      endAll()
      const unlisten = stop
      stop = undefined
      await unlisten?.().catch(() => {})
    },
  }
}

/**
 * What a person hears of a notice: the event for the dashboard, nothing when they may not see
 * it, or `unknown-project` when the project is not in `scope` (created since it was loaded, so
 * the caller loads it again once). A project is heard about only if the access policy lets the
 * person see it; a notice about someone's inbox only by that person.
 */
export function liveEventFor(
  notice: LiveNotice,
  userId: string,
  scope: getLiveScope.Result,
): Live.Event | undefined | 'unknown-project' {
  // Access notices steer the stream itself and never become events.
  if (notice.type === 'access.changed' || notice.type === 'session.ended') return undefined
  if ('userId' in notice) return notice.userId === userId ? { type: notice.type } : undefined
  const project = scope.projects.find((p) => p.id === notice.projectId)
  if (!project) return 'unknown-project'
  const workspace = scope.workspaces.find((w) => w.id === project.workspaceId)
  if (!workspace) return undefined
  const actor: Actor = {
    userId,
    instanceAdmin: false,
    role: workspace.role,
    projectMember: project.isMember,
  }
  if (!canSeeProject(actor).allow) return undefined
  return {
    type: notice.type,
    workspace: workspace.slug,
    project: project.slug,
    ...(notice.build === undefined ? {} : { build: notice.build }),
  }
}

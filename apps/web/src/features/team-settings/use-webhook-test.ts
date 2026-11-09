import type { Team } from '@circi/api'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { useTestWebhook } from '#features/teams/api/index.ts'
import { keys } from '#lib/query-keys.ts'

/** How often the webhook's deliveries are refetched after a test was queued. */
export const TEST_POLL_MS = 1500
/** How long to wait for the worker to deliver it before giving up on watching. */
export const TEST_POLL_LIMIT_MS = 20_000

export namespace useWebhookTest {
  export interface Watch {
    hookId: string
    deliveryId: string
    gaveUp: boolean
  }
  export interface State extends Watch {
    /** The delivery once it has shown up; absent while waiting or after giving up. */
    delivery?: Team.WebhookDelivery
  }
}

/**
 * Sends a test event and watches for its delivery: the queue answers 202 at once, the worker
 * delivers a moment later, so the settings are refetched every `TEST_POLL_MS` until the delivery
 * with the returned id is listed (or `TEST_POLL_LIMIT_MS` pass).
 */
export function useWebhookTest(
  workspace: string,
  team: string,
  hooks: readonly { id: string; deliveries: readonly Team.WebhookDelivery[] }[],
  on: { queued: (hookId: string) => void; delivered: (delivery: Team.WebhookDelivery) => void },
) {
  const queryClient = useQueryClient()
  const send = useTestWebhook(workspace, team)
  const [watch, setWatch] = useState<useWebhookTest.Watch>()

  const delivery = watch
    ? hooks
        .find((h) => h.id === watch.hookId)
        ?.deliveries.find((d) => d.deliveryId === watch.deliveryId)
    : undefined
  const waiting = watch !== undefined && !delivery && !watch.gaveUp

  const arrivedId = delivery?.deliveryId
  const delivered = useRef(on.delivered)
  delivered.current = on.delivered
  useEffect(() => {
    if (arrivedId && delivery) delivered.current(delivery)
    // Once per arrival.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedId])

  useEffect(() => {
    if (!waiting) return undefined
    const started = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - started >= TEST_POLL_LIMIT_MS) {
        clearInterval(timer)
        setWatch((w) => (w ? { ...w, gaveUp: true } : w))
        return
      }
      void queryClient.invalidateQueries({ queryKey: keys.teamSettings(workspace, team) })
    }, TEST_POLL_MS)
    return () => clearInterval(timer)
  }, [waiting, queryClient, workspace, team])

  const state: useWebhookTest.State | undefined = watch
    ? { ...watch, ...(delivery ? { delivery } : {}) }
    : undefined

  return {
    send: (hookId: string) =>
      send.mutate(hookId, {
        onSuccess: (result) => {
          setWatch({ hookId, deliveryId: result.deliveryId, gaveUp: false })
          on.queued(hookId)
        },
      }),
    isSending: (hookId: string) => send.isPending && send.variables === hookId,
    error: send.error,
    state,
  }
}

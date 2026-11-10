import type { Push } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, send } from '#lib/http.ts'
import { keys } from '#lib/query-keys.ts'

import { turnOffPush, turnOnPush, type TurnOn } from './push-client.ts'

export const pushDevicesQuery = () =>
  queryOptions({
    queryKey: keys.pushDevices(),
    queryFn: () => getJson<Push.Devices>('/api/push/devices'),
  })

/**
 * Turns push on or off for this browser. A refused permission is not an error here: the store
 * says `denied`, and the page shows the blocked state.
 */
export function useTogglePush() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (on: boolean): Promise<TurnOn> => {
      if (on) return turnOnPush()
      await turnOffPush()
      return { ok: true }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.pushDevices() }),
  })
}

/** Removes one of the person's other devices. */
export function useRemoveDevice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => send<Push.Devices>('DELETE', `/api/push/devices/${id}`),
    onSuccess: (devices) => queryClient.setQueryData(keys.pushDevices(), devices),
  })
}

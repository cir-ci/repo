import type { Instance } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { instancePath } from '#lib/api-paths.ts'
import { getJson, post } from '#lib/http.ts'
import { keys } from '#lib/query-keys.ts'

export const noticesQuery = () =>
  queryOptions({
    queryKey: keys.instanceNotices(),
    queryFn: () => getJson<Instance.Notices>(instancePath('notices')),
  })

export function useDismissAddressChange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => post<undefined>(instancePath('notices', 'public-url', 'dismiss'), {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.instanceNotices() }),
  })
}

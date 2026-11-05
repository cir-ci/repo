import type { Instance } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post } from '../../lib/http.ts'

export const noticesQuery = () =>
  queryOptions({
    queryKey: ['instance-notices'],
    queryFn: () => getJson<Instance.Notices>('/api/instance/notices'),
  })

export function useDismissAddressChange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => post<undefined>('/api/instance/notices/public-url/dismiss', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instance-notices'] }),
  })
}

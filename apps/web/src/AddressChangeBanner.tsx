import { Alert, Box, Button } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getJson } from './api.ts'

interface Notices {
  publicUrlChange: { from: string; to: string; checklist: string[] } | null
}

/** Tells instance admins the dashboard moved to a new address, with what's left to do. */
export function AddressChangeBanner() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['instance-notices'],
    queryFn: () => getJson<Notices>('/api/instance/notices'),
  })
  const dismiss = useMutation({
    mutationFn: () =>
      fetch('/api/instance/notices/public-url/dismiss', { method: 'POST' }).then((res) => {
        if (!res.ok) throw new Error('Couldn’t dismiss this')
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instance-notices'] }),
  })
  const change = data?.publicUrlChange
  if (!change) return null
  return (
    <Alert
      severity="warning"
      sx={{ m: 2 }}
      action={
        <Button
          color="inherit"
          size="small"
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate()}
        >
          Done
        </Button>
      }
    >
      <strong>
        The dashboard moved from {change.from} to {change.to}.
      </strong>
      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
        {change.checklist.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </Box>
    </Alert>
  )
}

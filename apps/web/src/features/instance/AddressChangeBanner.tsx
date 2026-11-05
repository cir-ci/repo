import { Alert, Box, Button } from '@mui/material'
import { useQuery } from '@tanstack/react-query'

import { noticesQuery, useDismissAddressChange } from './api.ts'

/** Tells instance admins the dashboard moved to a new address, with what's left to do. */
export function AddressChangeBanner() {
  const { data } = useQuery(noticesQuery())
  const dismiss = useDismissAddressChange()
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

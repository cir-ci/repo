import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { useState } from 'react'

import { useRotateToken } from './api.ts'
import { SecretBox } from './CreateDialogs.tsx'

export function CiToken({ org, project }: CiToken.Props) {
  const rotate = useRotateToken(org, project)
  const [confirming, setConfirming] = useState(false)
  return (
    <Box component="section" sx={{ maxWidth: 560 }}>
      <Typography variant="h2" component="h2" sx={{ mb: 1 }}>
        CI token
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1.5 }}>
        CI jobs upload with this project’s token. A token is only shown when it’s created, so if
        it’s lost, replace it: the old one stops working immediately.
      </Typography>
      {rotate.data ? (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          <Typography sx={{ mb: 1 }}>
            New token. Copy it now and update <code>CIRCI_TOKEN</code> in your CI secrets: it isn’t
            shown again.
          </Typography>
          <SecretBox label="CI token" value={rotate.data.token} />
        </Alert>
      ) : null}
      {rotate.error ? (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {rotate.error.message}
        </Alert>
      ) : null}
      {confirming ? (
        <Stack direction="row" spacing={1}>
          <Button
            color="error"
            variant="contained"
            disabled={rotate.isPending}
            onClick={() => rotate.mutate(undefined, { onSettled: () => setConfirming(false) })}
          >
            Replace token
          </Button>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
        </Stack>
      ) : (
        <Button variant="outlined" onClick={() => setConfirming(true)}>
          Replace CI token…
        </Button>
      )}
    </Box>
  )
}

export namespace CiToken {
  export interface Props {
    org: string
    project: string
  }
}

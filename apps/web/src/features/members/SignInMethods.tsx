import { Alert, Box, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'

import { orgAuthQuery, useSaveOrgAuth } from './api.ts'

/** Which login methods this organization accepts; the server keeps at least one usable by an owner. */
export function SignInMethods({ org }: SignInMethods.Props) {
  const { data } = useQuery(orgAuthQuery(org))
  const save = useSaveOrgAuth(org)
  if (!data) return null
  const { settings, instance } = data
  const toggle = (patch: Partial<typeof settings>) => save.mutate(patch)
  return (
    <Box component="section">
      <Typography variant="h2" component="h2" sx={{ mb: 0.5 }}>
        Sign-in methods
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1 }}>
        People sign in with any method the instance offers, but this organization only shows its
        projects to sessions that used a method you accept here.
      </Typography>
      <Stack>
        <FormControlLabel
          label="Password"
          control={
            <Checkbox
              checked={settings.passwordLoginEnabled && instance.password}
              disabled={!instance.password || save.isPending}
              onChange={(_, on) => toggle({ passwordLoginEnabled: on })}
            />
          }
        />
        <FormControlLabel
          label={instance.email ? 'Email code' : 'Email code (not set up on this instance)'}
          control={
            <Checkbox
              checked={settings.emailLoginEnabled && instance.email}
              disabled={!instance.email || save.isPending}
              onChange={(_, on) => toggle({ emailLoginEnabled: on })}
            />
          }
        />
      </Stack>
      {save.error ? (
        <Alert severity="error" sx={{ mt: 1, maxWidth: 560 }}>
          {save.error.message}
        </Alert>
      ) : null}
    </Box>
  )
}

export namespace SignInMethods {
  export interface Props {
    org: string
  }
}

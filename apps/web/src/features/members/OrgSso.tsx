import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import type { FormEvent } from 'react'

import { orgSsoQuery, useOrgSso } from './api.ts'

/**
 * The organization's own OpenID Connect provider. People it signs in join this organization and
 * can open nothing else; the organization's name is how they find it on the sign-in page.
 */
export function OrgSso({ org }: OrgSso.Props) {
  const { data } = useQuery(orgSsoQuery(org))
  const { register, remove } = useOrgSso(org)
  const failure = register.error ?? remove.error
  const providers = data?.providers ?? []

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const field = (k: string) => {
      const v = new FormData(form).get(k)
      return typeof v === 'string' ? v.trim() : ''
    }
    await register.mutateAsync({
      issuer: field('issuer'),
      clientId: field('clientId'),
      clientSecret: field('clientSecret'),
    })
    form.reset()
  }

  return (
    <Box component="section">
      <Typography variant="h2" component="h2" sx={{ mb: 0.5 }}>
        Single sign-on
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1.5 }}>
        Connect your own OpenID Connect provider (Okta, Entra ID, Keycloak…). People sign in from
        the sign-in page with “{org}” and join as members. Their session opens this organization
        only, and an address that already has an account elsewhere is refused.
      </Typography>
      {providers.map((p) => (
        <Alert
          key={p.providerId}
          severity="success"
          sx={{ mb: 1.5, maxWidth: 640 }}
          action={
            <Button color="inherit" size="small" onClick={() => remove.mutate(p.providerId)}>
              Remove
            </Button>
          }
        >
          <strong>{p.issuer}</strong>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            Redirect address to register at the provider: <code>{p.redirectUri}</code>
          </Typography>
        </Alert>
      ))}
      {providers.length === 0 ? (
        <Box component="form" onSubmit={(e) => void submit(e)} noValidate sx={{ maxWidth: 560 }}>
          <Stack spacing={1.5}>
            <TextField
              name="issuer"
              label="Issuer address"
              placeholder="https://login.example.com"
              required
              size="small"
            />
            <TextField name="clientId" label="Client id" required size="small" />
            <TextField
              name="clientSecret"
              label="Client secret"
              type="password"
              required
              size="small"
              autoComplete="off"
            />
            <Box>
              <Button type="submit" variant="outlined" disabled={register.isPending}>
                Connect provider
              </Button>
            </Box>
          </Stack>
        </Box>
      ) : null}
      {failure ? (
        <Alert severity="error" sx={{ mt: 1, maxWidth: 560 }}>
          {failure.message}
        </Alert>
      ) : null}
    </Box>
  )
}
export namespace OrgSso {
  export interface Props {
    org: string
  }
}

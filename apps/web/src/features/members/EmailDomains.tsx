import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { domainsQuery, useDomainActions } from './api.ts'

/** Email domains this organization claims: people signing in with a code on one join as members. */
export function EmailDomains({ org }: EmailDomains.Props) {
  const { data } = useQuery(domainsQuery(org))
  const { add, verify, remove } = useDomainActions(org)
  const [checked, setChecked] = useState<string | null>(null)
  const failure = add.error ?? verify.error ?? remove.error

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const raw = new FormData(form).get('domain')
    await add.mutateAsync(typeof raw === 'string' ? raw : '')
    form.reset()
  }

  return (
    <Box component="section">
      <Typography variant="h2" component="h2" sx={{ mb: 0.5 }}>
        Email domains
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1.5 }}>
        Once a domain is verified, anyone who signs in with an emailed code on an address at that
        domain joins this organization as a member, with no invitation.
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, mb: 1.5, p: 0 }}>
        {(data?.domains ?? []).map((d) => (
          <Box
            component="li"
            key={d.id}
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              p: 1.5,
              mb: 1,
              maxWidth: 640,
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography sx={{ fontWeight: 600, flex: 1 }}>{d.domain}</Typography>
              <Typography variant="body2" color={d.verified ? 'success.main' : 'text.secondary'}>
                {d.verified ? 'Verified' : 'Not verified'}
              </Typography>
              <Button size="small" color="error" onClick={() => remove.mutate(d.id)}>
                Remove
              </Button>
            </Stack>
            {d.verified ? null : (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  Add this DNS TXT record, then check:
                </Typography>
                <Box
                  component="code"
                  sx={{
                    display: 'block',
                    overflowWrap: 'anywhere',
                    fontFamily: 'monospace',
                    typography: 'body2',
                  }}
                >
                  {d.dnsName} TXT {d.dnsValue}
                </Box>
                <Button
                  size="small"
                  sx={{ mt: 1 }}
                  disabled={verify.isPending}
                  onClick={() =>
                    verify.mutate(d.id, { onSuccess: (r) => setChecked(r.verified ? null : d.id) })
                  }
                >
                  Check now
                </Button>
                {checked === d.id ? (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    component="span"
                    sx={{ ml: 1 }}
                  >
                    Not found yet. DNS can take a few minutes to spread.
                  </Typography>
                ) : null}
              </Box>
            )}
          </Box>
        ))}
      </Box>
      <Box component="form" onSubmit={(e) => void submit(e)} noValidate>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap>
          <TextField
            name="domain"
            label="Domain"
            placeholder="example.com"
            size="small"
            required
            sx={{ maxWidth: 280 }}
          />
          <Button type="submit" variant="outlined" disabled={add.isPending}>
            Add domain
          </Button>
        </Stack>
      </Box>
      {failure ? (
        <Alert severity="error" sx={{ mt: 1, maxWidth: 560 }}>
          {failure.message}
        </Alert>
      ) : null}
    </Box>
  )
}

export namespace EmailDomains {
  export interface Props {
    org: string
  }
}

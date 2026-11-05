import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState, type FormEvent } from 'react'

import { RelativeTime } from '../../components.tsx'
import { useAnnounce } from '../../primitives/feedback.tsx'
import { Row, Section } from '../../primitives/Rows.tsx'
import { useAddWebhook, useDeleteWebhook } from './api.ts'

export function Webhooks(props: Webhooks.Props) {
  const add = useAddWebhook(props.org, props.project)
  const remove = useDeleteWebhook(props.org, props.project)
  const announce = useAnnounce()
  const [secret, setSecret] = useState<{ url: string; value: string } | null>(null)
  const [picked, setPicked] = useState<string[]>(props.events)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const raw = new FormData(form).get('url')
    const url = typeof raw === 'string' ? raw.trim() : ''
    const created = await add.mutateAsync({ url, events: picked })
    form.reset()
    setSecret({ url: created.webhook.url, value: created.secret })
    announce('Webhook added')
  }

  return (
    <Stack spacing={2}>
      <Section title="Webhooks" count={props.hooks.length}>
        {props.hooks.length === 0 ? (
          <Row
            primary="No webhooks yet"
            secondary="Get a signed POST to your own service when a build finishes or is reviewed."
          />
        ) : (
          props.hooks.map((h) => (
            <Row
              key={h.id}
              primary={h.url}
              secondary={
                <>
                  {h.events.join(', ')} · added <RelativeTime iso={h.createdAt} />
                </>
              }
              action={
                props.canManage ? (
                  <Button
                    color="error"
                    size="small"
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(h.id, { onSuccess: () => announce('Webhook removed') })
                    }
                  >
                    Remove
                  </Button>
                ) : null
              }
            />
          ))
        )}
      </Section>
      {remove.error ? <Alert severity="error">{remove.error.message}</Alert> : null}
      {secret ? (
        <Alert severity="success" onClose={() => setSecret(null)}>
          <Typography sx={{ fontWeight: 600 }}>Signing secret for {secret.url}</Typography>
          <Typography
            component="code"
            sx={{ display: 'block', my: 0.5, fontFamily: 'monospace', overflowWrap: 'anywhere' }}
          >
            {secret.value}
          </Typography>
          Copy it now: it isn’t shown again. Verify each request’s <code>CirCI-Signature</code>{' '}
          header with it.
        </Alert>
      ) : null}
      {props.canManage ? (
        <Box component="form" onSubmit={(e) => void submit(e)} noValidate sx={{ maxWidth: 560 }}>
          <Typography variant="h3" component="h3" sx={{ mb: 1 }}>
            Add a webhook
          </Typography>
          <Stack spacing={1.5}>
            <TextField
              name="url"
              type="url"
              label="Address"
              placeholder="https://hooks.example.com/circi"
              required
              size="small"
              helperText="Must be a public address."
            />
            <FormGroup row>
              {props.events.map((event) => (
                <FormControlLabel
                  key={event}
                  label={event}
                  control={
                    <Checkbox
                      checked={picked.includes(event)}
                      onChange={(_, on) =>
                        setPicked((p) => (on ? [...p, event] : p.filter((x) => x !== event)))
                      }
                    />
                  }
                />
              ))}
            </FormGroup>
            {add.error ? <Alert severity="error">{add.error.message}</Alert> : null}
            <Box>
              <Button
                type="submit"
                variant="contained"
                disabled={add.isPending || picked.length === 0}
              >
                {add.isPending ? 'Adding…' : 'Add webhook'}
              </Button>
            </Box>
          </Stack>
        </Box>
      ) : null}
    </Stack>
  )
}

export namespace Webhooks {
  export interface Props {
    org: string
    project: string
    hooks: { id: string; url: string; events: string[]; createdAt: string }[]
    events: string[]
    canManage: boolean
  }
}

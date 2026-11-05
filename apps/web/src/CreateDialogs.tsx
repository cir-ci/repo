import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { type Capabilities, useCreateOrganization, useCreateProject } from './api.ts'
import { useAnnounce } from './primitives/feedback.tsx'

function field(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/** A secret shown once, with a way to copy it. */
export function SecretBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Box>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box
        component="code"
        sx={{
          display: 'block',
          my: 0.5,
          p: 1,
          bgcolor: 'action.hover',
          borderRadius: 1,
          fontFamily: 'monospace',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </Box>
      <Button
        size="small"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => setCopied(true))
            .catch(() => setCopied(false))
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </Box>
  )
}

export function NewOrganizationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateOrganization()
  const announce = useAnnounce()

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const name = field(new FormData(e.currentTarget), 'name')
    await create.mutateAsync(name)
    announce(`Organization ${name} created`)
    create.reset()
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <Box component="form" onSubmit={(e) => void submit(e)} noValidate>
        <DialogTitle>New organization</DialogTitle>
        <DialogContent>
          <TextField
            name="name"
            label="Name"
            required
            autoFocus
            fullWidth
            size="small"
            sx={{ mt: 1 }}
          />
          {create.error ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {create.error.message}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={create.isPending}>
            Create
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}

export function NewProjectDialog(props: {
  open: boolean
  onClose: () => void
  organizations: Capabilities['manageableOrganizations']
}) {
  const create = useCreateProject()
  const navigate = useNavigate()
  const [created, setCreated] = useState<{ org: string; slug: string; token: string } | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const org = field(form, 'org')
    const result = await create.mutateAsync({ org, name: field(form, 'name') })
    setCreated({ org, slug: result.project.slug, token: result.token })
  }

  function close() {
    const next = created
    setCreated(null)
    create.reset()
    props.onClose()
    if (next) void navigate({ to: '/$org/$project', params: { org: next.org, project: next.slug } })
  }

  return (
    <Dialog open={props.open} onClose={created ? undefined : close} fullWidth maxWidth="sm">
      {created ? (
        <>
          <DialogTitle>Project created</DialogTitle>
          <DialogContent>
            <Alert severity="warning" sx={{ mb: 2 }}>
              Copy this CI token now: it isn’t shown again. Put it in your CI secrets as{' '}
              <code>CIRCI_TOKEN</code>.
            </Alert>
            <SecretBox label="CI token" value={created.token} />
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={close}>
              I’ve saved it
            </Button>
          </DialogActions>
        </>
      ) : (
        <Box component="form" onSubmit={(e) => void submit(e)} noValidate>
          <DialogTitle>New project</DialogTitle>
          <DialogContent>
            <TextField
              name="org"
              label="Organization"
              select
              required
              fullWidth
              size="small"
              defaultValue={props.organizations[0]?.slug ?? ''}
              sx={{ mt: 1 }}
            >
              {props.organizations.map((o) => (
                <MenuItem key={o.slug} value={o.slug}>
                  {o.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              name="name"
              label="Name"
              required
              fullWidth
              size="small"
              sx={{ mt: 2 }}
              helperText="Usually the repository’s name."
            />
            {create.error ? (
              <Alert severity="error" sx={{ mt: 2 }}>
                {create.error.message}
              </Alert>
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={create.isPending}>
              Create
            </Button>
          </DialogActions>
        </Box>
      )}
    </Dialog>
  )
}

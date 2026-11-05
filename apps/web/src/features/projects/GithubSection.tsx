import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { type FormEvent } from 'react'

import { useGithubLink } from './api.ts'

export function GithubLink(props: GithubLink.Props) {
  const { save, remove } = useGithubLink(props.org, props.project)
  const link = props.github.link
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const text = (k: string) => {
      const v = form.get(k)
      return typeof v === 'string' ? v.trim() : ''
    }
    await save.mutateAsync({ repoRef: text('repoRef'), installationId: text('installationId') })
  }
  return (
    <Box component="section" sx={{ maxWidth: 560 }}>
      <Typography variant="h2" component="h2" sx={{ mb: 1 }}>
        GitHub
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1.5 }}>
        Builds show up on the pull request as a check with Approve and Reject buttons, and as one
        summary comment. The GitHub App’s webhook address is <code>{props.github.webhookUrl}</code>.
      </Typography>
      {link ? (
        <Alert severity="success" sx={{ mb: 1.5 }}>
          Reporting to <strong>{link.repoRef}</strong> (installation {link.installationId}).
        </Alert>
      ) : null}
      {props.canManage ? (
        <Box component="form" onSubmit={(e) => void submit(e)} noValidate>
          <Stack spacing={1.5}>
            <TextField
              name="repoRef"
              label="Repository"
              placeholder="acme/web"
              defaultValue={link?.repoRef ?? ''}
              required
              size="small"
            />
            <TextField
              name="installationId"
              label="GitHub App installation id"
              defaultValue={link?.installationId ?? ''}
              required
              size="small"
              helperText="The number at the end of the installation’s settings address on GitHub."
            />
            {save.error ? <Alert severity="error">{save.error.message}</Alert> : null}
            <Stack direction="row" spacing={1}>
              <Button type="submit" variant="contained" disabled={save.isPending}>
                {link ? 'Update link' : 'Link repository'}
              </Button>
              {link ? (
                <Button color="error" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  Unlink
                </Button>
              ) : null}
            </Stack>
          </Stack>
        </Box>
      ) : null}
    </Box>
  )
}

export namespace GithubLink {
  export interface Props {
    org: string
    project: string
    github: { webhookUrl: string; link: { installationId: string; repoRef: string } | null }
    canManage: boolean
  }
}

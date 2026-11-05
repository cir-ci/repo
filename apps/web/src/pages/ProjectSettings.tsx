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
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import {
  type ProjectSettings,
  settingsQuery,
  useAddWebhook,
  useDeleteWebhook,
  useGithubLink,
  useRotateToken,
  useSaveSettings,
} from '../api.ts'
import { ErrorState, RelativeTime, useDocumentTitle } from '../components.tsx'
import { SecretBox } from '../CreateDialogs.tsx'
import { ListSkeleton, useAnnounce } from '../primitives/feedback.tsx'
import { PageHeader } from '../primitives/PageHeader.tsx'
import { PageLayout } from '../primitives/PageLayout.tsx'
import { Row, Section } from '../primitives/Rows.tsx'

/** A project's settings, and where it sends webhooks. Owners and admins edit; members look. */
export function ProjectSettingsPage() {
  const { org, project } = useParams({ from: '/$org/$project/settings' })
  const { data, error, refetch } = useQuery(settingsQuery(org, project))
  useDocumentTitle('Settings', project)

  return (
    <PageLayout header={<PageHeader title={`${data?.settings.name ?? project} settings`} />}>
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          notFound="This project doesn’t exist"
        />
      ) : !data ? (
        <ListSkeleton />
      ) : (
        <Stack spacing={4}>
          {data.canManage ? null : (
            <Alert severity="info">Only owners and admins can change these settings.</Alert>
          )}
          <SettingsForm
            // A fresh form whenever the saved values change, so it never shows stale input.
            key={JSON.stringify(data.settings)}
            org={org}
            project={project}
            settings={data.settings}
            canManage={data.canManage}
          />
          {data.canManage ? <CiToken org={org} project={project} /> : null}
          {data.github.configured ? (
            <GithubLink
              org={org}
              project={project}
              github={data.github}
              canManage={data.canManage}
            />
          ) : null}
          <Webhooks
            org={org}
            project={project}
            hooks={data.webhooks}
            events={data.webhookEvents}
            canManage={data.canManage}
          />
        </Stack>
      )}
    </PageLayout>
  )
}

function SettingsForm(props: {
  org: string
  project: string
  settings: ProjectSettings
  canManage: boolean
}) {
  const save = useSaveSettings(props.org, props.project)
  const announce = useAnnounce()
  const [saved, setSaved] = useState(false)
  const s = props.settings

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const text = (key: string) => {
      const v = form.get(key)
      return typeof v === 'string' ? v : ''
    }
    setSaved(false)
    await save.mutateAsync({
      name: text('name'),
      defaultBranch: text('defaultBranch'),
      diffThreshold: Number(text('diffThresholdPercent')) / 100,
      retentionDays: Number(text('retentionDays')),
      autoApproveDefaultBranch: form.has('autoApproveDefaultBranch'),
      blockMergeOnChanges: form.has('blockMergeOnChanges'),
    })
    setSaved(true)
    announce('Settings saved')
  }

  return (
    <Box component="form" onSubmit={(e) => void submit(e)} noValidate>
      <Typography variant="h2" component="h2" sx={{ mb: 1.5 }}>
        Builds
      </Typography>
      <Stack spacing={2} sx={{ maxWidth: 560 }}>
        <TextField
          name="name"
          label="Name"
          defaultValue={s.name}
          size="small"
          disabled={!props.canManage}
        />
        <TextField
          name="defaultBranch"
          label="Default branch"
          defaultValue={s.defaultBranch}
          size="small"
          disabled={!props.canManage}
          helperText="Builds on this branch become the baselines that pull requests are compared with."
        />
        <TextField
          name="diffThresholdPercent"
          label="Ignore differences below (% of pixels)"
          type="number"
          defaultValue={Number((s.diffThreshold * 100).toFixed(4))}
          size="small"
          disabled={!props.canManage}
          slotProps={{ htmlInput: { min: 0, max: 100, step: 'any' } }}
          helperText="0 reports every changed pixel."
        />
        <TextField
          name="retentionDays"
          label="Keep builds for (days)"
          type="number"
          defaultValue={s.retentionDays}
          size="small"
          disabled={!props.canManage}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
        />
        <FormGroup>
          <FormControlLabel
            control={
              <Checkbox
                name="blockMergeOnChanges"
                defaultChecked={s.blockMergeOnChanges}
                disabled={!props.canManage}
              />
            }
            label="Block merging until changes are approved"
          />
          <Typography variant="body2" color="text.secondary" sx={{ ml: 4, mt: -0.5, mb: 1 }}>
            With this off, `circi upload --wait` passes even when visual changes need review.
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                name="autoApproveDefaultBranch"
                defaultChecked={s.autoApproveDefaultBranch}
                disabled={!props.canManage}
              />
            }
            label="Approve builds on the default branch automatically"
          />
        </FormGroup>
        {save.error ? <Alert severity="error">{save.error.message}</Alert> : null}
        {saved ? <Alert severity="success">Settings saved.</Alert> : null}
        {props.canManage ? (
          <Box>
            <Button type="submit" variant="contained" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save settings'}
            </Button>
          </Box>
        ) : null}
      </Stack>
    </Box>
  )
}

function Webhooks(props: {
  org: string
  project: string
  hooks: { id: string; url: string; events: string[]; createdAt: string }[]
  events: string[]
  canManage: boolean
}) {
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

function CiToken({ org, project }: { org: string; project: string }) {
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

function GithubLink(props: {
  org: string
  project: string
  github: { webhookUrl: string; link: { installationId: string; repoRef: string } | null }
  canManage: boolean
}) {
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

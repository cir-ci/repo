import {
  Banner,
  Button,
  Checkbox,
  CheckboxGroup,
  ConfirmDialog,
  ListRow,
  SectionHeader,
  Text,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { type FormEvent, useState } from 'react'

import { RelativeTime } from '#lib/RelativeTime.tsx'

import { useAddWebhook, useDeleteWebhook } from './api.ts'
import { SecretBox } from './CreateDialogs.tsx'

import styles from './SettingsSection.module.css'
import hookStyles from './WebhooksSection.module.css'

export function Webhooks(props: Webhooks.Props) {
  const add = useAddWebhook(props.workspace, props.team)
  const remove = useDeleteWebhook(props.workspace, props.team)
  const announce = useAnnounce()
  const [secret, setSecret] = useState<{ url: string; value: string } | null>(null)
  const [picked, setPicked] = useState<string[]>(props.events)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Webhooks.Hook | null>(null)

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const raw = new FormData(form).get('url')
    const url = typeof raw === 'string' ? raw.trim() : ''
    // Both problems are shown together, and nothing is sent until both are fixed.
    setUrlError(url ? null : 'Enter an address')
    setEventsError(picked.length === 0 ? 'Choose at least one event' : null)
    if (!url || picked.length === 0) return
    add.mutate(
      { url, events: picked },
      {
        onSuccess: (created) => {
          form.reset()
          setSecret({ url: created.webhook.url, value: created.secret })
          announce('Webhook added')
        },
      },
    )
  }

  return (
    <section className={styles.section}>
      <SectionHeader
        divided
        title={
          <>
            Webhooks{' '}
            <Text variant="micro" tone="tertiary">
              {props.hooks.length}
            </Text>
          </>
        }
        description="Get a signed POST to your own service when a build finishes or is reviewed."
      />
      <ul aria-label="Webhooks" className={hookStyles['list']}>
        {props.hooks.length === 0 ? (
          <li>
            <ListRow>
              <Text tone="secondary">No webhooks yet</Text>
            </ListRow>
          </li>
        ) : (
          props.hooks.map((h) => (
            <li key={h.id}>
              <ListRow
                trailing={
                  props.canManage ? (
                    <Button variant="danger" size="sm" onClick={() => setRemoving(h)}>
                      Remove
                    </Button>
                  ) : undefined
                }
              >
                <Text variant="mono" truncate as="div">
                  {h.url}
                </Text>
                <div className={hookStyles['meta']}>
                  <ul aria-label="Events" className={hookStyles['events']}>
                    {h.events.map((event) => (
                      <li key={event} className={hookStyles['chip']}>
                        <Text variant="micro" tone="secondary">
                          {event}
                        </Text>
                      </li>
                    ))}
                  </ul>
                  <Text variant="small" tone="secondary">
                    added <RelativeTime iso={h.createdAt} />
                  </Text>
                </div>
              </ListRow>
            </li>
          ))
        )}
      </ul>
      {remove.error && !removing ? <Banner tone="danger">{remove.error.message}</Banner> : null}
      {secret ? (
        <Banner
          tone="success"
          title={`Signing secret for ${secret.url}`}
          action={
            <Button variant="ghost" size="sm" onClick={() => setSecret(null)}>
              Dismiss
            </Button>
          }
        >
          <div className={hookStyles['secret']}>
            <SecretBox label="Signing secret" value={secret.value} />
          </div>
          Copy it now: it isn’t shown again. Verify each request’s{' '}
          <Text as="code" variant="mono">
            CirCI-Signature
          </Text>{' '}
          header with it.
        </Banner>
      ) : null}
      {props.canManage ? (
        <form onSubmit={submit} noValidate className={styles.fields}>
          <Text as="strong" variant="body" className={hookStyles['formTitle']}>
            Add a webhook
          </Text>
          <TextField
            name="url"
            type="url"
            label="Address"
            placeholder="https://hooks.example.com/circi"
            required
            description="Must be a public address."
            error={urlError}
          />
          <div className={hookStyles['eventsField']}>
            <CheckboxGroup
              legend="Events"
              value={picked}
              onValueChange={(next) => {
                setPicked(next)
                if (next.length > 0) setEventsError(null)
              }}
            >
              <div className={styles.checks}>
                {props.events.map((event) => (
                  <Checkbox key={event} value={event} label={event} />
                ))}
              </div>
            </CheckboxGroup>
            {eventsError ? (
              <Text variant="small" tone="rejected" role="alert">
                {eventsError}
              </Text>
            ) : null}
          </div>
          {add.error ? <Banner tone="danger">{add.error.message}</Banner> : null}
          <div className={styles.actions}>
            <Button type="submit" variant="primary" loading={add.isPending}>
              {add.isPending ? 'Adding…' : 'Add webhook'}
            </Button>
          </div>
        </form>
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title="Remove webhook?"
        description={
          removing ? (
            <>
              <Text as="code" variant="mono" className={hookStyles['wrap']}>
                {removing.url}
              </Text>{' '}
              stops receiving build events right away. This can’t be undone.
            </>
          ) : undefined
        }
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => {
          if (!removing) return
          remove.mutate(removing.id, {
            onSuccess: () => announce('Webhook removed'),
            onSettled: () => setRemoving(null),
          })
        }}
      />
    </section>
  )
}

export namespace Webhooks {
  export interface Hook {
    id: string
    url: string
    events: string[]
    createdAt: string
  }
  export interface Props {
    workspace: string
    team: string
    hooks: Hook[]
    events: string[]
    canManage: boolean
  }
}

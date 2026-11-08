import type { Issue } from '@circi/api'
import { Banner, Button, Dialog, Select, Text, TextField, useAnnounce } from '@circi/ui'
import { type FormEvent, useId, useState } from 'react'

import styles from './Discussion.module.css'

/**
 * "Create issue": a title, the tracker when the team has two, and a preview of the description
 * the tracker will get (the build link, branch, author, why it was rejected and the diff link).
 * The server calls the tracker; a failure is shown here and nothing is recorded.
 */
export function CreateIssueDialog(props: CreateIssueDialog.Props) {
  const { trackers, defaultTitle, description, snapshotName } = props
  const [title, setTitle] = useState<string | null>(null)
  const [picked, setPicked] = useState(trackers[0]?.integrationId ?? '')
  const announce = useAnnounce()
  const formId = useId()
  const tracker = trackers.find((t) => t.integrationId === picked) ?? trackers[0]
  const shownTitle = title ?? defaultTitle
  const name = tracker ? TRACKER_NAMES[tracker.kind] : 'the tracker'

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!tracker || props.pending || shownTitle.trim() === '') return
    props.onCreate(
      {
        integrationId: tracker.integrationId,
        ...(snapshotName ? { snapshotName } : {}),
        ...(title !== null && title.trim() !== defaultTitle ? { title: title.trim() } : {}),
      },
      (issue) => {
        announce(`Created ${issue.key}`)
        setTitle(null)
      },
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          setTitle(null)
          props.onCancel()
        }
      }}
      title="Create issue"
      description={
        snapshotName
          ? `For the snapshot “${snapshotName}” in ${name}.`
          : `For this build in ${name}.`
      }
      size="wide"
      actions={
        <>
          <Button type="button" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={`${formId}-form`}
            variant="primary"
            loading={props.pending}
            disabled={shownTitle.trim() === ''}
          >
            Create issue
          </Button>
        </>
      }
    >
      <form id={`${formId}-form`} onSubmit={submit} className={styles.form}>
        {trackers.length > 1 ? (
          <Select
            label="Tracker"
            items={trackers.map((t) => ({
              value: t.integrationId,
              label: `${TRACKER_NAMES[t.kind]} (${t.name})`,
            }))}
            value={tracker?.integrationId ?? ''}
            onValueChange={setPicked}
          />
        ) : null}
        <TextField
          label="Title"
          value={shownTitle}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <div>
          <Text variant="small" tone="secondary">
            Description
          </Text>
          <Text as="p" variant="small" className={styles.preview} aria-label="Description preview">
            {description}
          </Text>
        </div>
        {props.error ? <Banner tone="danger">{props.error.message}</Banner> : null}
      </form>
    </Dialog>
  )
}

const TRACKER_NAMES: Record<string, string> = { linear: 'Linear', jira: 'Jira' }

export namespace CreateIssueDialog {
  export interface Props {
    open: boolean
    trackers: Issue.Tracker[]
    /** The screenshot the issue is about; null for the whole build. */
    snapshotName: string | null
    defaultTitle: string
    description: string
    pending: boolean
    error: Error | null
    onCancel: () => void
    onCreate: (input: Issue.Create, onCreated: (issue: Issue.Ref) => void) => void
  }
}

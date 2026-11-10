import type { Issue } from '@circi/api'
import { Banner, FormDialog, SegmentedControl, Text, TextField } from '@circi/ui'
import { useState } from 'react'

import { toast } from '#lib/toast.ts'

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
  const tracker = trackers.find((t) => t.integrationId === picked) ?? trackers[0]
  const shownTitle = title ?? defaultTitle
  const name = tracker ? (TRACKER_NAMES[tracker.kind] ?? tracker.kind) : 'the tracker'

  function submit() {
    if (!tracker || props.pending || shownTitle.trim() === '') return
    props.onCreate(
      {
        integrationId: tracker.integrationId,
        ...(snapshotName ? { snapshotName } : {}),
        ...(title !== null && title.trim() !== defaultTitle ? { title: title.trim() } : {}),
      },
      (issue) => {
        toast(`Created ${issue.key}`)
        setTitle(null)
      },
    )
  }

  return (
    <FormDialog
      open={props.open}
      onClose={() => {
        setTitle(null)
        props.onCancel()
      }}
      onCancel={props.onCancel}
      onSubmit={submit}
      title="Create issue"
      description={
        snapshotName
          ? `For the screenshot “${snapshotName}” in ${name}.`
          : `For this build in ${name}.`
      }
      size="wide"
      submitLabel="Create issue"
      pending={props.pending}
      submitDisabled={shownTitle.trim() === ''}
      formClassName={styles.form}
    >
      {trackers.length > 1 ? (
        <SegmentedControl
          label="Tracker"
          options={trackers.map((t) => ({
            value: t.integrationId,
            label: TRACKER_NAMES[t.kind] ?? t.kind,
          }))}
          value={tracker?.integrationId ?? ''}
          onChange={setPicked}
        />
      ) : null}
      {tracker?.kind === 'jira' ? (
        <Text variant="small" tone="secondary">
          Project{' '}
          <Text as="code" variant="mono">
            {tracker.target}
          </Text>{' '}
          in {tracker.name}
        </Text>
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
      <Text variant="small" tone="tertiary">
        The issue links back to this build.
      </Text>
    </FormDialog>
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

import type { ReviewRule } from '@circi/api'
import {
  Banner,
  Button,
  Checkbox,
  CheckboxGroup,
  ConfirmDialog,
  EmptyState,
  ListRow,
  SectionHeader,
  Select,
  Text,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { useState } from 'react'

import {
  draftOf,
  draftProblem,
  emptyDraft,
  isRuleKind,
  kindLabel,
  RULE_KINDS,
  reviewerNames,
  ruleDirty,
  type RuleDraft,
  useRuleActions,
} from './api.ts'

import styles from './Settings.module.css'

type Editing = { id: string | null; draft: RuleDraft } | null

/** Who is asked to review which snapshots or builds. A rule is a glob and its reviewers. */
export function RulesSection(props: RulesSection.Props) {
  const actions = useRuleActions(props.workspace, props.team)
  const announce = useAnnounce()
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<ReviewRule.Item | null>(null)
  const failure = actions.create.error ?? actions.update.error ?? actions.remove.error

  return (
    <section className={styles.section}>
      <SectionHeader
        title="Review rules"
        description="When a build has a screenshot or a name that matches, these people are asked to review it. Use * within a name and ** across folders."
        action={
          props.canManage && !editing ? (
            <Button onClick={() => setEditing({ id: null, draft: emptyDraft() })}>Add rule</Button>
          ) : undefined
        }
      />
      {failure ? <Banner tone="danger">{failure.message}</Banner> : null}
      {props.rules.length === 0 && !editing ? (
        <EmptyState title="No review rules">
          Without rules, nobody is asked to review automatically.
        </EmptyState>
      ) : null}
      <ul className={styles.list} aria-label="Review rules">
        {props.rules.map((rule) =>
          editing?.id === rule.id ? (
            <li key={rule.id}>
              <RuleEditor {...editorProps(props, editing, setEditing, actions, announce, rule)} />
            </li>
          ) : (
            <li key={rule.id}>
              <ListRow
                density="two-line"
                trailing={
                  props.canManage ? (
                    <div className={styles.actions}>
                      <Button
                        aria-label={`Edit rule ${rule.pattern}`}
                        onClick={() => setEditing({ id: rule.id, draft: draftOf(rule) })}
                      >
                        Edit
                      </Button>
                      <Button
                        aria-label={`Delete rule ${rule.pattern}`}
                        onClick={() => setDeleting(rule)}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : undefined
                }
              >
                <div className={styles.who}>
                  <Text variant="mono" truncate>
                    {rule.pattern}
                  </Text>
                  <Text variant="small" tone="secondary" truncate>
                    {kindLabel(rule.kind)} · {reviewerNames(rule)}
                  </Text>
                </div>
              </ListRow>
            </li>
          ),
        )}
      </ul>
      {editing && editing.id === null ? (
        <RuleEditor {...editorProps(props, editing, setEditing, actions, announce)} />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="Delete this rule?"
        description={deleting ? `${deleting.pattern} will no longer ask anyone to review.` : ''}
        confirmLabel="Delete rule"
        onConfirm={() => {
          if (!deleting) return
          actions.remove.mutate(deleting.id, {
            onSuccess: () => announce('Rule deleted'),
            onSettled: () => setDeleting(null),
          })
        }}
      />
    </section>
  )
}

function editorProps(
  props: RulesSection.Props,
  editing: NonNullable<Editing>,
  setEditing: (e: Editing) => void,
  actions: ReturnType<typeof useRuleActions>,
  announce: (message: string) => void,
  rule?: ReviewRule.Item,
): RuleEditor.Props {
  const mutation = editing.id === null ? actions.create : actions.update
  return {
    draft: editing.draft,
    people: props.people,
    saving: mutation.isPending,
    dirty: rule ? ruleDirty(rule, editing.draft) : true,
    onChange: (draft) => setEditing({ id: editing.id, draft }),
    onCancel: () => setEditing(null),
    onSave: () => {
      const done = {
        onSuccess: () => {
          announce(editing.id === null ? 'Rule added' : 'Rule saved')
          setEditing(null)
        },
      }
      if (editing.id === null) actions.create.mutate(editing.draft, done)
      else actions.update.mutate({ id: editing.id, draft: editing.draft }, done)
    },
  }
}

function RuleEditor(props: RuleEditor.Props) {
  const [touched, setTouched] = useState(false)
  const problem = draftProblem(props.draft)
  const { draft } = props
  return (
    <form
      className={styles.editor}
      noValidate
      aria-label="Rule"
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (!problem) props.onSave()
      }}
    >
      <Select
        label="Matches"
        items={RULE_KINDS.map((k) => ({ value: k.value, label: k.label }))}
        value={draft.kind}
        onValueChange={(kind) => {
          if (isRuleKind(kind)) props.onChange({ ...draft, kind })
        }}
      />
      <TextField
        name="pattern"
        label="Pattern"
        value={draft.pattern}
        onChange={(e) => props.onChange({ ...draft, pattern: e.target.value })}
        error={touched && problem && draft.reviewerIds.length > 0 ? problem : undefined}
        description={
          draft.kind === 'snapshot-name'
            ? 'A screenshot name, like checkout/** or Button*.'
            : 'A build name, like release/*.'
        }
      />
      <CheckboxGroup legend="Reviewers">
        {props.people.map((p) => (
          <Checkbox
            key={p.id}
            label={p.name}
            checked={draft.reviewerIds.includes(p.id)}
            onCheckedChange={(on) =>
              props.onChange({
                ...draft,
                reviewerIds: on
                  ? [...draft.reviewerIds, p.id]
                  : draft.reviewerIds.filter((id) => id !== p.id),
              })
            }
          />
        ))}
      </CheckboxGroup>
      {touched && problem && draft.reviewerIds.length === 0 ? (
        <Banner tone="danger">{problem}</Banner>
      ) : null}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={props.saving} disabled={!props.dirty}>
          {props.saving ? 'Saving…' : 'Save rule'}
        </Button>
        <Button onClick={props.onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

namespace RuleEditor {
  export interface Props {
    draft: RuleDraft
    people: { id: string; name: string }[]
    saving: boolean
    dirty: boolean
    onChange: (draft: RuleDraft) => void
    onCancel: () => void
    onSave: () => void
  }
}

export namespace RulesSection {
  export interface Props {
    workspace: string
    team: string
    rules: ReviewRule.Item[]
    people: { id: string; name: string }[]
    canManage: boolean
  }
}

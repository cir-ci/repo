import type { ReviewRule, Triage } from '@circi/api'
import {
  Avatar,
  Banner,
  Button,
  Checkbox,
  CheckboxGroup,
  ConfirmDialog,
  EmptyState,
  FormDialog,
  IconButton,
  Menu,
  PlusIcon,
  RowMenuIcon,
  Select,
  SettingsSection,
  Text,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { Fragment, useState } from 'react'

import {
  draftOf,
  draftProblem,
  emptyDraft,
  isRuleKind,
  movedRuleIds,
  type Person,
  RULE_KINDS,
  ruleDirty,
  type RuleDraft,
  useRuleActions,
} from './api.ts'

import styles from './ReviewsSettings.module.css'

type Editing = { id: string | null; draft: RuleDraft } | null

/**
 * Who is asked to review which screenshots or builds: a rule is a glob and its reviewers, the
 * first match wins. Adding and editing happen in a dialog and Delete asks first; each applies when
 * confirmed (there is no Save for rules).
 */
export function RulesSection(props: RulesSection.Props) {
  const actions = useRuleActions(props.workspace, props.team)
  const announce = useAnnounce()
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<ReviewRule.Item | null>(null)
  const failure = actions.remove.error ?? actions.reorder.error
  const person = (id: string, name: string): Person =>
    props.people.find((p) => p.id === id) ?? { id, name }

  function move(rule: ReviewRule.Item, by: -1 | 1) {
    const ids = movedRuleIds(props.rules, rule.id, by)
    if (!ids) return
    actions.reorder.mutate(ids, {
      onSuccess: () =>
        announce(`${rule.pattern} moved ${by < 0 ? 'up' : 'down'} to ${ids.indexOf(rule.id) + 1}`),
    })
  }

  return (
    <SettingsSection
      title="Review rules"
      description={`When a build has changes, CirCI requests review from the first matching rule's people, who are ${props.teamName}'s members. Like CODEOWNERS for screenshots.`}
      bare
    >
      {failure ? <Banner tone="danger">{failure.message}</Banner> : null}
      {props.rules.length === 0 ? (
        <EmptyState title="No review rules">
          Without rules, nobody is asked to review automatically.
        </EmptyState>
      ) : (
        <ul className={styles.rules} aria-label="Review rules">
          {props.rules.map((rule, index) => (
            <li key={rule.id}>
              <div className={styles.rule}>
                <span className={styles.position}>{index + 1}</span>
                <span className={styles.when}>
                  {rule.kind === 'snapshot-name' ? 'Screenshot matches' : 'Build name is'}
                  <Text variant="mono" className={styles.pattern}>
                    {rule.pattern}
                  </Text>
                </span>
                <span className={styles.arrow} aria-hidden="true">
                  →
                </span>
                {rule.reviewers.map((r, i) => {
                  const p = person(r.id, r.name)
                  return (
                    <Fragment key={r.id}>
                      {i > 0 ? <Text tone="secondary">and</Text> : null}
                      <span className={styles.person}>
                        <Avatar type="user" id={p.id} name={p.name} image={p.image ?? null} />
                        {p.name}
                      </span>
                    </Fragment>
                  )
                })}
                <span className={styles.grow} />
                {props.canManage ? (
                  <Menu
                    align="end"
                    trigger={
                      <IconButton label={`Actions for rule ${rule.pattern}`}>
                        <RowMenuIcon />
                      </IconButton>
                    }
                    items={[
                      {
                        label: 'Edit',
                        onSelect: () => setEditing({ id: rule.id, draft: draftOf(rule) }),
                      },
                      {
                        label: 'Move up',
                        disabled: index === 0 || actions.reorder.isPending,
                        onSelect: () => move(rule, -1),
                      },
                      {
                        label: 'Move down',
                        disabled: index === props.rules.length - 1 || actions.reorder.isPending,
                        onSelect: () => move(rule, 1),
                      },
                      { type: 'separator' },
                      { label: 'Delete', tone: 'danger', onSelect: () => setDeleting(rule) },
                    ]}
                  />
                ) : null}
              </div>
            </li>
          ))}
          <li>
            <div className={`${styles.rule} ${styles.fallback}`}>
              <span className={styles.position} aria-hidden="true">
                ∗
              </span>
              <span className={styles.when}>Otherwise</span>
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
              {props.rotation.members.length > 0 ? (
                <>
                  <span>Rotate through</span>
                  <span className={styles.stack}>
                    {props.rotation.members.map((m) => {
                      const p = person(m.id, m.name)
                      return (
                        <Avatar
                          key={m.id}
                          type="user"
                          id={p.id}
                          name={p.name}
                          image={p.image ?? null}
                        />
                      )
                    })}
                  </span>
                  <Text tone="secondary">one per build</Text>
                </>
              ) : (
                <Text tone="secondary">Nobody is asked</Text>
              )}
            </div>
          </li>
        </ul>
      )}
      {props.canManage ? (
        <div>
          <Button
            leading={<PlusIcon size={12} />}
            onClick={() => setEditing({ id: null, draft: emptyDraft() })}
          >
            Add rule
          </Button>
        </div>
      ) : null}
      {editing ? (
        <RuleDialog
          key={editing.id ?? 'new'}
          adding={editing.id === null}
          draft={editing.draft}
          rule={props.rules.find((r) => r.id === editing.id)}
          people={props.people}
          pending={editing.id === null ? actions.create.isPending : actions.update.isPending}
          error={editing.id === null ? actions.create.error : actions.update.error}
          onChange={(draft) => setEditing({ id: editing.id, draft })}
          onClose={() => {
            actions.create.reset()
            actions.update.reset()
            setEditing(null)
          }}
          onSave={() => {
            const done = {
              onSuccess: () => {
                announce(editing.id === null ? 'Rule added' : 'Rule saved')
                setEditing(null)
              },
            }
            if (editing.id === null) actions.create.mutate(editing.draft, done)
            else actions.update.mutate({ id: editing.id, draft: editing.draft }, done)
          }}
        />
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
    </SettingsSection>
  )
}

/** Adds a rule or edits one: what it matches, the pattern and the team members it asks. */
function RuleDialog(props: RuleDialog.Props) {
  const [touched, setTouched] = useState(false)
  const { draft } = props
  const problem = draftProblem(draft)
  return (
    <FormDialog
      open
      onClose={props.onClose}
      onSubmit={() => {
        setTouched(true)
        if (!problem) props.onSave()
      }}
      title={props.adding ? 'Add rule' : 'Edit rule'}
      submitLabel={props.adding ? 'Add rule' : 'Save rule'}
      pending={props.pending}
      submitDisabled={props.rule ? !ruleDirty(props.rule, draft) : false}
      formClassName={styles.stackForm}
      noValidate
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
            ? 'A screenshot name, like checkout/** or Button*. Use * within a name and ** across folders.'
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
      {props.error ? <Banner tone="danger">{props.error.message}</Banner> : null}
    </FormDialog>
  )
}

namespace RuleDialog {
  export interface Props {
    adding: boolean
    draft: RuleDraft
    /** The rule being edited, to tell whether anything changed. */
    rule: ReviewRule.Item | undefined
    people: Person[]
    pending: boolean
    error: Error | null
    onChange: (draft: RuleDraft) => void
    onClose: () => void
    onSave: () => void
  }
}

export namespace RulesSection {
  export interface Props {
    workspace: string
    team: string
    teamName: string
    rules: ReviewRule.Item[]
    rotation: Triage.Rotation
    people: Person[]
    canManage: boolean
  }
}

import type { Team, Triage } from '@circi/api'
import { Banner, Button, useAnnounce } from '@circi/ui'
import { type FormEvent, useState } from 'react'

import { useSaveSettings } from '#features/teams/api/index.ts'
import { HttpError } from '#lib/http.ts'

import {
  type FormValues,
  formProblems,
  formValuesOf,
  type Person,
  rotationBody,
  rotationDirty,
  startDateProblem,
  settingsPatch,
  useRuleActions,
} from './api.ts'
import { AutomationSection } from './AutomationSection.tsx'
import { NotifySection } from './NotifySection.tsx'
import { ReviewTargetSection } from './ReviewTargetSection.tsx'
import { RotationSection } from './RotationSection.tsx'

import teamStyles from '#features/team-settings/TeamSettings.module.css'

/**
 * The settings below the rules, saved together: the review target, the automation, and triage
 * (the rotation, the flaky threshold, the snooze default). One Save sends what changed, one
 * request after the other (the settings, then the rotation). The rules above apply as they are
 * confirmed, each in its own dialog.
 */
export function ReviewsForm(props: ReviewsForm.Props) {
  const saveSettings = useSaveSettings(props.workspace, props.team)
  const { rotation: saveRotation } = useRuleActions(props.workspace, props.team)
  const announce = useAnnounce()
  const saved = formValuesOf(props.settings, props.rotation)
  const [values, setValues] = useState<FormValues>(saved)
  const [dateUnreadable, setDateUnreadable] = useState(false)
  const [touched, setTouched] = useState(false)
  const [done, setDone] = useState(false)
  const [failure, setFailure] = useState<Error | null>(null)
  const [saving, setSaving] = useState(false)

  const patch = settingsPatch(props.settings, values)
  const settingsChanged = Object.keys(patch).length > 0
  const rotationChanged =
    rotationDirty(props.rotation, values.rotationIds, values.rotationDate) || dateUnreadable
  const dirty = settingsChanged || rotationChanged
  const disabled = !props.canManage
  const fields = failure instanceof HttpError ? failure.fields : {}

  function edit(change: Partial<FormValues>) {
    setValues({ ...values, ...change })
    setDone(false)
  }

  function discard() {
    setValues(saved)
    setDateUnreadable(false)
    setTouched(false)
    setDone(false)
    setFailure(null)
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched(true)
    // Typed text that is not a date leaves the value empty, and no change event says so.
    const dateInput = e.currentTarget.elements.namedItem('startsOn')
    const unreadable =
      dateUnreadable || (dateInput instanceof HTMLInputElement && dateInput.validity.badInput)
    if (unreadable !== dateUnreadable) setDateUnreadable(unreadable)
    const problems = formProblems(values)
    if (
      problems.hours ||
      problems.flakyAfter ||
      startDateProblem(values.rotationDate, unreadable)
    ) {
      return
    }
    setDone(false)
    setFailure(null)
    setSaving(true)
    try {
      if (settingsChanged) await saveSettings.mutateAsync(patch)
      if (rotationChanged) {
        await saveRotation.mutateAsync(rotationBody(values.rotationIds, values.rotationDate))
      }
      setDone(true)
      announce('Settings saved')
    } catch (err) {
      setFailure(err instanceof Error ? err : new Error("Couldn't save"))
    } finally {
      setSaving(false)
    }
  }

  const fieldMessages = ['reviewTargetHours', 'reviewOverdueNotifyUserId', 'flakyAfterChanges']
  const shownByField = fieldMessages.some((f) => fields[f])
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className={teamStyles.form}>
      <ReviewTargetSection
        hours={values.hours}
        notifyUserId={values.notifyUserId}
        people={props.people}
        touched={touched}
        serverProblem={fields['reviewTargetHours']}
        notifyProblem={fields['reviewOverdueNotifyUserId']}
        disabled={disabled}
        onHoursChange={(hours) => edit({ hours })}
        onNotifyChange={(notifyUserId) => edit({ notifyUserId })}
        className={teamStyles.number}
      />
      <AutomationSection
        close={values.close}
        reRequest={values.reRequest}
        autoApprove={values.autoApprove}
        requireReason={values.requireReason}
        disabled={disabled}
        onCloseChange={(close) => edit({ close })}
        onReRequestChange={(reRequest) => edit({ reRequest })}
        onAutoApproveChange={(autoApprove) => edit({ autoApprove })}
        onRequireReasonChange={(requireReason) => edit({ requireReason })}
      />
      <RotationSection
        teamName={props.settings.name}
        defaultBranch={props.settings.defaultBranch}
        people={props.people}
        ids={values.rotationIds}
        date={values.rotationDate}
        flakyAfter={values.flakyAfter}
        snoozeDays={values.snoozeDays}
        touched={touched}
        serverFlakyProblem={fields['flakyAfterChanges']}
        disabled={disabled}
        onIdsChange={(rotationIds) => edit({ rotationIds })}
        dateUnreadable={dateUnreadable}
        onDateChange={(rotationDate, unreadable) => {
          edit({ rotationDate })
          setDateUnreadable(unreadable)
        }}
        onFlakyChange={(flakyAfter) => edit({ flakyAfter })}
        onSnoozeChange={(snoozeDays) => edit({ snoozeDays })}
      />
      <NotifySection workspace={props.workspace} team={props.team} />
      {failure && !shownByField ? <Banner tone="danger">{failure.message}</Banner> : null}
      {done ? <Banner tone="success">Settings saved.</Banner> : null}
      {props.canManage ? (
        <div className={teamStyles.footer}>
          <Button type="button" variant="ghost" onClick={discard} disabled={!dirty || saving}>
            Discard
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      ) : null}
    </form>
  )
}

export namespace ReviewsForm {
  export interface Props {
    workspace: string
    team: string
    settings: Pick<
      Team.Settings,
      | 'name'
      | 'defaultBranch'
      | 'reviewTargetHours'
      | 'reviewOverdueNotifyUserId'
      | 'closeReviewsOnNewerBuild'
      | 'reRequestOnNewerBuild'
      | 'autoApproveNoChanges'
      | 'requireRejectReason'
      | 'flakyAfterChanges'
      | 'snoozeDefaultDays'
    >
    rotation: Triage.Rotation
    people: Person[]
    canManage: boolean
  }
}

import type { Team, Triage } from '@circi/api'
import { Banner, Button, useAnnounce } from '@circi/ui'
import { type FormEvent, useState } from 'react'

import { useSaveSettings } from '#features/teams/api/index.ts'
import { HttpError } from '#lib/http.ts'

import {
  rotationBody,
  rotationDirty,
  startDateOf,
  startDateProblem,
  targetDirty,
  targetProblem,
  targetText,
  targetValue,
  useRuleActions,
} from './api.ts'
import { AutomationSection } from './AutomationSection.tsx'
import { NotifySection } from './NotifySection.tsx'
import { ReviewTargetSection } from './ReviewTargetSection.tsx'
import { RotationSection } from './RotationSection.tsx'

import teamStyles from '#features/team-settings/TeamSettings.module.css'

/**
 * The settings below the rules, saved together: the review target and the triage rotation. One
 * Save sends what changed, one request after the other (the target, then the rotation); the rest
 * of the page is fixed behaviour. The rules above save as they are edited, each in its own editor.
 */
export function ReviewsForm(props: ReviewsForm.Props) {
  const saveSettings = useSaveSettings(props.workspace, props.team)
  const { rotation: saveRotation } = useRuleActions(props.workspace, props.team)
  const announce = useAnnounce()
  const savedHours = props.settings.reviewTargetHours
  const [enabled, setEnabled] = useState(savedHours !== null)
  const [hours, setHours] = useState(targetText(savedHours))
  const [ids, setIds] = useState(() => props.rotation.members.map((m) => m.id))
  const [date, setDate] = useState(startDateOf(props.rotation))
  const [dateUnreadable, setDateUnreadable] = useState(false)
  const [touched, setTouched] = useState(false)
  const [done, setDone] = useState(false)
  const [failure, setFailure] = useState<Error | null>(null)
  const [saving, setSaving] = useState(false)

  const targetChanged = targetDirty(savedHours, enabled, hours)
  const rotationChanged = rotationDirty(props.rotation, ids, date) || dateUnreadable
  const dirty = targetChanged || rotationChanged
  const disabled = !props.canManage

  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value)
      setDone(false)
    }
  }

  function discard() {
    setEnabled(savedHours !== null)
    setHours(targetText(savedHours))
    setIds(props.rotation.members.map((m) => m.id))
    setDate(startDateOf(props.rotation))
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
    if ((enabled && targetProblem(hours)) || startDateProblem(date, unreadable)) return
    setDone(false)
    setFailure(null)
    setSaving(true)
    try {
      if (targetChanged) {
        await saveSettings.mutateAsync({ reviewTargetHours: targetValue(enabled, hours) })
      }
      if (rotationChanged) await saveRotation.mutateAsync(rotationBody(ids, date))
      setDone(true)
      announce('Settings saved')
    } catch (err) {
      setFailure(err instanceof Error ? err : new Error('Could not save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className={teamStyles.form}>
      <ReviewTargetSection
        saved={savedHours}
        enabled={enabled}
        hours={hours}
        touched={touched}
        serverProblem={failure instanceof HttpError ? failure.fields.reviewTargetHours : undefined}
        disabled={disabled}
        onEnabledChange={edited(setEnabled)}
        onHoursChange={edited(setHours)}
        className={teamStyles.number}
      />
      <AutomationSection />
      <RotationSection
        workspace={props.workspace}
        team={props.team}
        people={props.people}
        ids={ids}
        date={date}
        disabled={disabled}
        onIdsChange={edited(setIds)}
        dateUnreadable={dateUnreadable}
        onDateChange={(next, unreadable) => {
          setDate(next)
          setDateUnreadable(unreadable)
          setDone(false)
        }}
      />
      <NotifySection workspace={props.workspace} team={props.team} />
      {failure && !(failure instanceof HttpError && failure.fields.reviewTargetHours) ? (
        <Banner tone="danger">{failure.message}</Banner>
      ) : null}
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
    settings: Pick<Team.Settings, 'reviewTargetHours'>
    rotation: Triage.Rotation
    people: { id: string; name: string }[]
    canManage: boolean
  }
}

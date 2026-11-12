import type { Inbox, Push } from '@circi/api'
import { describeDevice } from '@circi/core'
import {
  Badge,
  Button,
  SettingsRow,
  SettingsSection,
  Switch,
  Text,
  useAnnounce,
  visuallyHidden,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { pushDevicesQuery, useRemoveDevice, useTogglePush } from '#features/pwa/api.ts'
import { currentPlatform } from '#features/pwa/platform.ts'
import { refreshPushState } from '#features/pwa/push-client.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { SaveNote } from '#lib/SaveNote.tsx'
import { usePwaStore } from '#lib/stores/pwa-store.ts'

import { PUSH_ROWS, useSetPreference } from './api.ts'

import styles from './NotificationsPage.module.css'

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' })

/**
 * Web push in the notification settings: this device first (a switch that saves as it flips),
 * the person's other devices with Remove, then which kinds to push (per person, like email,
 * for every device that is on). Always there, so the installed app never lacks it: where this
 * browser can't push the device row says why instead of a switch, and says what to do when the
 * browser blocked it; on an iPhone that isn't on the Home Screen the switch gives way to the steps.
 */
export function PushSection({ preferences }: PushSection.Props) {
  const permission = usePwaStore((s) => s.pushPermission)
  const endpoint = usePwaStore((s) => s.pushEndpoint)
  const setSheetOpen = usePwaStore((s) => s.setSheetOpen)
  const devices = useQuery({ ...pushDevicesQuery(), enabled: permission !== 'unsupported' })
  const toggle = useTogglePush()
  const remove = useRemoveDevice()
  const setPreference = useSetPreference()
  const [last, setLast] = useState<keyof Inbox.Preferences | null>(null)
  const announce = useAnnounce()
  const platform = currentPlatform()
  const needsHomeScreen = platform.ios && !platform.standalone
  const unsupported = permission === 'unsupported' && !needsHomeScreen

  // The state is read once when the app starts, before its service worker may be ready: read it
  // again here, so an installed app that lost that race doesn't say push isn't supported.
  useEffect(() => {
    if (permission === 'unsupported') void refreshPushState()
    // Once, on arriving at the page.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mine = devices.data?.devices.find((d) => d.endpoint === endpoint)
  const others = (devices.data?.devices ?? []).filter((d) => d.endpoint !== endpoint)
  const on = endpoint !== null
  const label = mine?.label ?? describeDevice(navigator.userAgent)

  return (
    <>
      <SettingsSection title="Push notifications">
        <SettingsRow
          label={label}
          status={<Badge shape="tag">This device</Badge>}
          detail={
            needsHomeScreen
              ? 'Notifications on iPhone work from the Home Screen.'
              : unsupported
                ? unsupportedText()
                : permission === 'denied'
                  ? "Notifications are blocked for this site. Allow them in your browser's or device's settings, then reload this page."
                  : on
                    ? mine
                      ? `On since ${shortDate(mine.createdAt)}`
                      : 'On'
                    : 'Off'
          }
        >
          {needsHomeScreen ? (
            <Button size="sm" onClick={() => setSheetOpen(true)}>
              Add to Home Screen
            </Button>
          ) : unsupported ? null : (
            <span className={styles.control}>
              {toggle.error ? (
                <Text variant="small" tone="failed" role="alert">
                  {toggle.error.message}
                </Text>
              ) : null}
              <Switch
                label={<span style={visuallyHidden}>Push notifications on this device</span>}
                checked={on}
                disabled={permission === 'denied' || toggle.isPending}
                onCheckedChange={(next) =>
                  toggle.mutate(next, {
                    onSuccess: () => announce(`Push notifications ${next ? 'on' : 'off'}`),
                  })
                }
              />
            </span>
          )}
        </SettingsRow>
        {others.map((device) => (
          <DeviceRow
            key={device.id}
            device={device}
            removing={remove.isPending && remove.variables === device.id}
            onRemove={() => remove.mutate(device.id)}
          />
        ))}
        {remove.error ? (
          <Text variant="small" tone="failed" role="alert">
            {remove.error.message}
          </Text>
        ) : null}
      </SettingsSection>

      {unsupported ? null : (
        <SettingsSection title="What to push">
          {PUSH_ROWS.map((row) => (
            <SettingsRow key={row.key} label={row.label} detail={row.description}>
              <span className={styles.control}>
                {last === row.key ? <SaveNote mutation={setPreference} /> : null}
                <Switch
                  label={<span style={visuallyHidden}>Push: {row.label}</span>}
                  checked={preferences[row.key]}
                  onCheckedChange={(next) => {
                    setLast(row.key)
                    setPreference.mutate(
                      { [row.key]: next },
                      { onSuccess: () => announce(`${row.label} ${next ? 'on' : 'off'}, saved`) },
                    )
                  }}
                />
              </span>
            </SettingsRow>
          ))}
        </SettingsSection>
      )}
    </>
  )
}

/** Why this browser has no push: what it lacks, so the person knows whether a different one helps. */
function unsupportedText(): string {
  if (!window.isSecureContext)
    return "Notifications need a secure (HTTPS) connection, and this page isn't one."
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return "This browser can't receive push notifications. Chrome, Edge, Firefox and Safari 16.4 or later can."
  }
  return "Notifications aren't available here yet: this browser's background service isn't running. Reload the page, and if this stays, use another browser."
}

function DeviceRow({
  device,
  removing,
  onRemove,
}: {
  device: Push.Device
  removing: boolean
  onRemove: () => void
}) {
  return (
    <SettingsRow
      label={device.label}
      detail={
        device.lastUsedAt ? (
          <>
            Last used <RelativeTime iso={device.lastUsedAt} />
          </>
        ) : (
          'Not used yet'
        )
      }
    >
      <Button size="sm" loading={removing} aria-label={`Remove ${device.label}`} onClick={onRemove}>
        Remove
      </Button>
    </SettingsRow>
  )
}

export namespace PushSection {
  export interface Props {
    preferences: Inbox.Preferences
  }
}

import type { Slack } from '@circi/api'
import {
  SLACK_DEFAULT_EVENTS,
  SLACK_EVENT_LABEL,
  SLACK_EVENTS,
  type SlackEvent,
} from '@circi/core/slack'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, send, seg } from '#lib/http.ts'

// ---- Logic (tested in Node) -------------------------------------------------------------------

export { SLACK_DEFAULT_EVENTS, SLACK_EVENT_LABEL, SLACK_EVENTS, type SlackEvent }

/** What the callback says in `?slack=`, as a sentence; null for nothing to say. */
export function installNote(result: unknown): { tone: 'success' | 'danger'; text: string } | null {
  switch (result) {
    case 'connected':
      return { tone: 'success', text: 'Slack is connected. Pick a channel for each project.' }
    case 'denied':
      return { tone: 'danger', text: 'Slack was not connected: the install was cancelled.' }
    case 'failed':
      return {
        tone: 'danger',
        text: 'Slack was not connected: Slack did not accept the install. Try again.',
      }
    default:
      return null
  }
}

/** The events of a project that has none saved yet: the ones that need someone to act. */
export const initialEvents = (saved: readonly Slack.Event[]): Slack.Event[] =>
  saved.length > 0 ? [...saved] : [...SLACK_DEFAULT_EVENTS]

/** The picker's items: the workspace's channels, with `#`, plus the current one if it is gone. */
export function channelItems(
  channels: readonly Slack.Channel[],
  current: { id: string | null; name: string | null },
): { value: string; label: string; name: string }[] {
  const items = channels.map((c) => ({
    value: c.id,
    label: c.private ? `${c.name} (private)` : `#${c.name}`,
    name: c.name,
  }))
  if (current.id && !items.some((i) => i.value === current.id)) {
    const name = current.name ?? current.id
    items.unshift({ value: current.id, label: `#${name}`, name })
  }
  return items
}

/** "Review requested, Build rejected", or "No events". */
export const eventsSummary = (events: readonly Slack.Event[]) =>
  events.length === 0 ? 'No events' : events.map((e) => SLACK_EVENT_LABEL[e]).join(', ')

/** Where the browser goes; a seam so tests can watch it instead of leaving the page. */
export const navigation = {
  assign(url: string) {
    window.location.assign(url)
  },
}

// ---- Server state -----------------------------------------------------------------------------

const base = (org: string) => `/api/orgs/${seg(org)}/integrations/slack`

export const slackPageQuery = (org: string) =>
  queryOptions({
    queryKey: ['integrations', org, 'slack'],
    queryFn: () => getJson<Slack.Page>(base(org)),
  })

export const slackChannelsQuery = (org: string, integrationId: string) =>
  queryOptions({
    queryKey: ['integrations', org, 'slack', 'channels', integrationId],
    queryFn: () =>
      getJson<{ channels: Slack.Channel[] }>(`${base(org)}/${seg(integrationId)}/channels`),
    staleTime: 60_000,
    retry: false,
  })

/** Asks the server for the Slack install address and goes there; Slack sends the browser back. */
export function useSlackInstall(org: string) {
  return useMutation({
    mutationFn: async () => {
      const { url } = await getJson<Slack.Install>(`${base(org)}/install`)
      navigation.assign(url)
    },
  })
}

export function useSlackMapping(org: string) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['integrations', org] })
  const url = (integrationId: string, project: string) =>
    `${base(org)}/${seg(integrationId)}/projects/${seg(project)}`
  return {
    save: useMutation({
      mutationFn: (input: { integrationId: string; project: string } & Slack.MappingInput) =>
        send<undefined>('PUT', url(input.integrationId, input.project), {
          channelId: input.channelId,
          channelName: input.channelName,
          events: input.events,
        }),
      onSuccess: refresh,
    }),
    clear: useMutation({
      mutationFn: (input: { integrationId: string; project: string }) =>
        send<undefined>('DELETE', url(input.integrationId, input.project)),
      onSuccess: refresh,
    }),
  }
}

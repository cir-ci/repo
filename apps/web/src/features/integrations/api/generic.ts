import type { Integration } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { workspacePath } from '#lib/api-paths.ts'
import { getJson, post, seg, send } from '#lib/http.ts'
import { keys } from '#lib/query-keys.ts'

// ---- Logic (tested in Node) -------------------------------------------------------------------
// Everything here works from a definition's public spec (`Integration.CatalogEntry`): the same code
// serves every integration.

/** Where the browser goes; a seam so tests can watch it instead of leaving the page. */
export const navigation = {
  assign(url: string) {
    window.location.assign(url)
  },
}

/** What the OAuth callback says in `?connect=`, as a sentence; null for nothing to say. */
export function connectNote(
  result: unknown,
  name: string,
): { tone: 'success' | 'danger'; text: string } | null {
  switch (result) {
    case 'connected':
      return { tone: 'success', text: `${name} is connected. Choose what each team uses.` }
    case 'denied':
      return { tone: 'danger', text: `${name} wasn't connected: the install was cancelled.` }
    case 'failed':
      return {
        tone: 'danger',
        text: `${name} wasn't connected: ${name} didn't accept the install. Try again.`,
      }
    default:
      return null
  }
}

/** The connect form's values, trimmed, leaving out optional fields that were left empty. */
export function credentialValues(
  fields: readonly Integration.CredentialField[],
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fields) {
    const v = (values[f.name] ?? '').trim()
    if (v !== '' || !f.optional) out[f.name] = v
  }
  return out
}

/** Whether every required field has a value. */
export const credentialsComplete = (
  fields: readonly Integration.CredentialField[],
  values: Readonly<Record<string, string>>,
) => fields.every((f) => f.optional || (values[f.name] ?? '').trim() !== '')

export type ExtraValues = Record<string, unknown>

/** A mapping's settings as the form starts: what is saved, or the field's defaults. */
export function initialExtra(
  fields: readonly Integration.MappingField[],
  saved: Readonly<ExtraValues> | null | undefined,
): ExtraValues {
  const out: ExtraValues = {}
  for (const f of fields) {
    const value = saved?.[f.key]
    if (f.kind === 'events') {
      out[f.key] = Array.isArray(value) ? [...value] : [...f.defaults]
    } else if (f.kind === 'toggle') {
      out[f.key] = typeof value === 'boolean' ? value : f.default
    } else {
      out[f.key] = typeof value === 'string' ? value : ''
    }
  }
  return out
}

/** The settings to send: text fields left empty are dropped. */
export function extraToSend(
  fields: readonly Integration.MappingField[],
  values: Readonly<ExtraValues>,
): ExtraValues {
  const out: ExtraValues = {}
  for (const f of fields) {
    const v = values[f.key]
    if (f.kind === 'text') {
      if (typeof v === 'string' && v.trim() !== '') out[f.key] = v.trim()
    } else if (v !== undefined) {
      out[f.key] = v
    }
  }
  return out
}

/** Whether the form can be saved: a target, and every required text field. */
export function canSave(
  spec: Integration.MappingSpec,
  ref: string,
  values: Readonly<ExtraValues>,
): boolean {
  return (
    ref.trim() !== '' &&
    spec.fields.every(
      (f) =>
        f.kind !== 'text' ||
        f.optional ||
        (typeof values[f.key] === 'string' && values[f.key] !== ''),
    )
  )
}

/** Whether every field of the add-link form has a value. */
export const linkValuesComplete = (
  spec: Pick<Integration.LinksSpec, 'fields'>,
  values: Readonly<Record<string, string>>,
) => spec.fields.every((f) => (values[f.key] ?? '').trim() !== '')

/** The sentence after a "Link automatically" run. */
export function autoLinkSummary(result: Integration.AutoLinkResult): string {
  const linked =
    result.created === 0
      ? 'No new frames linked'
      : `Linked ${result.created} ${result.created === 1 ? 'screenshot' : 'screenshots'} to frames`
  return result.unlinked === 0
    ? `${linked}.`
    : `${linked}; ${result.unlinked} ${result.unlinked === 1 ? 'screenshot has' : 'screenshots have'} no frame with a matching name.`
}

/** The picker's items: the account's targets, plus the saved one if it is gone. */
export function targetItems(
  targets: readonly Integration.Target[],
  current: { ref: string; name: string | null } | null,
): { value: string; label: string; name: string }[] {
  const items = targets.map((t) => ({ value: t.id, label: t.label ?? t.name, name: t.name }))
  if (current && !items.some((i) => i.value === current.ref)) {
    const name = current.name ?? current.ref
    items.unshift({ value: current.ref, label: name, name })
  }
  return items
}

/** "Review requested, Build rejected", or "No events"; other settings add nothing to the line. */
export function mappingSummary(
  spec: Integration.MappingSpec,
  extra: Readonly<ExtraValues>,
): string | null {
  const events = spec.fields.find((f) => f.kind === 'events')
  if (!events || events.kind !== 'events') return null
  const stored = Array.isArray(extra[events.key]) ? extra[events.key] : events.defaults
  const labels = events.options
    .filter((o) => Array.isArray(stored) && stored.includes(o.event))
    .map((o) => o.label)
  return labels.length === 0 ? 'No events' : labels.join(', ')
}

/** Whether the row differs from what is saved: another target, or other settings. */
export function isDirty(
  spec: Integration.MappingSpec,
  saved: Integration.Mapping | null,
  ref: string,
  values: Readonly<ExtraValues>,
): boolean {
  if (ref.trim() !== (saved?.ref ?? '')) return true
  const before = extraToSend(spec.fields, initialExtra(spec.fields, saved?.extra))
  return JSON.stringify(before) !== JSON.stringify(extraToSend(spec.fields, values))
}

/** One repository of a git host's page, and the team that reports to it. */
export interface RepositoryRow {
  ref: string
  label: string
  /** The team mapped to it; null when none is. */
  team: string | null
  /** Mapped, but the host no longer lists it: the app was uninstalled from it. */
  broken: boolean
}

/**
 * The rows of a git host's page, repository first: every repository the host offers, and every
 * mapped one the host no longer lists (flagged only when the list loaded, `targets` not null),
 * mapped ones first, each group A to Z.
 */
export function repositoryRows(
  teams: readonly Integration.MappingTeam[],
  targets: readonly Integration.Target[] | null,
): RepositoryRow[] {
  const rows = new Map<string, RepositoryRow>()
  for (const t of targets ?? []) {
    rows.set(t.id, { ref: t.id, label: t.label ?? t.name, team: null, broken: false })
  }
  for (const team of teams) {
    const m = team.mapping
    if (!m) continue
    const known = rows.get(m.ref)
    rows.set(m.ref, {
      ref: m.ref,
      label: known?.label ?? m.name ?? m.ref,
      team: team.slug,
      broken: targets !== null && !known,
    })
  }
  return [...rows.values()].toSorted(
    (a, b) => Number(b.team !== null) - Number(a.team !== null) || a.label.localeCompare(b.label),
  )
}

/** "Michael's workspace · 3 teams use it": what the page says under the integration's name. */
export function connectionLine(
  kindName: string,
  account: string,
  teams: readonly Integration.MappingTeam[],
): string {
  const used = teams.filter((t) => t.mapping !== null).length
  const count =
    used === 0 ? 'no teams use it yet' : `${used} ${used === 1 ? 'team uses' : 'teams use'} it`
  return `${kindName} · ${account} · ${count}`
}

// ---- Server state -----------------------------------------------------------------------------

const base = (workspace: string, ...rest: string[]) =>
  workspacePath(workspace, 'integrations', ...rest)

export const mappingPageQuery = (workspace: string, id: string) =>
  queryOptions({
    queryKey: keys.integrations(workspace, 'mapping', id),
    queryFn: () => getJson<Integration.MappingPage>(base(workspace, id, 'teams')),
  })

export const targetsQuery = (workspace: string, id: string) =>
  queryOptions({
    queryKey: keys.integrations(workspace, 'targets', id),
    queryFn: () => getJson<{ targets: Integration.Target[] }>(base(workspace, id, 'targets')),
    staleTime: 60_000,
    retry: false,
  })

/** Asks the server for the provider's install address and goes there; it sends the browser back. */
export function useInstall(workspace: string) {
  return useMutation({
    meta: { what: 'install the integration' },
    mutationFn: async (kind: string) => {
      const { url } = await getJson<Integration.Install>(base(workspace, kind, 'install'))
      navigation.assign(url)
    },
  })
}

/** Connects with the form's values; the answer is the new integration's id. */
export function useConnect(workspace: string, kind: string) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'connect the integration' },
    mutationFn: (values: Record<string, string>) =>
      post<{ id: string }>(base(workspace, kind, 'connect'), values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.integrations(workspace) }),
  })
}

export function useMapping(workspace: string, id: string) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.integrations(workspace) })
  const url = (team: string) => base(workspace, id, 'teams', team)
  return {
    save: useMutation({
      meta: { what: 'save the mapping' },
      mutationFn: (input: { team: string } & Integration.MappingInput) =>
        send<undefined>('PUT', url(input.team), {
          ref: input.ref,
          ...(input.name ? { name: input.name } : {}),
          extra: input.extra ?? {},
        }),
      onSuccess: refresh,
    }),
    clear: useMutation({
      meta: { what: 'clear the mapping' },
      mutationFn: (team: string) => send<undefined>('DELETE', url(team)),
      onSuccess: refresh,
    }),
  }
}

const linksUrl = (workspace: string, id: string, team: string) =>
  base(workspace, id, 'teams', team, 'links')

export const linksQuery = (workspace: string, id: string, team: string) =>
  queryOptions({
    queryKey: keys.integrations(workspace, 'links', id, team),
    queryFn: () => getJson<Integration.LinkList>(linksUrl(workspace, id, team)),
  })

/** A team's links: add one by hand, remove one, or link by name (when the definition offers it). */
export function useLinks(workspace: string, id: string) {
  const queryClient = useQueryClient()
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: keys.integrations(workspace, 'links', id) })
  return {
    create: useMutation({
      meta: { what: 'add the link' },
      mutationFn: (input: { team: string; values: Record<string, string> }) =>
        post<Integration.Link>(linksUrl(workspace, id, input.team), {
          values: Object.fromEntries(
            Object.entries(input.values).map(([key, value]) => [key, value.trim()]),
          ),
        }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      meta: { what: 'remove the link' },
      mutationFn: (input: { team: string; linkId: string }) =>
        send<undefined>('DELETE', `${linksUrl(workspace, id, input.team)}/${seg(input.linkId)}`),
      onSuccess: refresh,
    }),
    auto: useMutation({
      meta: { what: 'link automatically' },
      mutationFn: (team: string) =>
        post<Integration.AutoLinkResult>(`${linksUrl(workspace, id, team)}/auto`, {}),
      onSuccess: refresh,
    }),
  }
}

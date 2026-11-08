import type { Figma } from '@circi/api'
import { parseFigmaFileRef, parseFigmaUrl } from '@circi/core/figma'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, seg, send } from '#lib/http.ts'

// ---- Logic (tested in Node) -------------------------------------------------------------------

/** A token is long; this only catches an empty or obviously partial paste (Figma has the say). */
export const isFigmaToken = (value: string) => value.trim().length >= 8

/** The address of a frame (it carries a `node-id`), not just of a file. */
export const isFrameAddress = (value: string) => Boolean(parseFigmaUrl(value)?.nodeId)

/** An address or key of a Figma file. */
export const isFileReference = (value: string) => parseFigmaFileRef(value) !== undefined

/** "3 of 47 frames linked", "3 frames linked" when the file's size isn't known, "No frames linked". */
export function linkedLabel(project: Pick<Figma.Project, 'linked' | 'frameCount'>): string {
  if (project.linked === 0) return 'No frames linked'
  const frames = project.linked === 1 ? 'frame' : 'frames'
  return project.frameCount === null
    ? `${project.linked} ${frames} linked`
    : `${project.linked} of ${project.frameCount} frames linked`
}

/** The sentence after a "Link automatically" run. */
export function autoLinkSummary(result: Figma.AutoLinkResult): string {
  const linked =
    result.created === 0
      ? 'No new frames linked'
      : `Linked ${result.created} ${result.created === 1 ? 'snapshot' : 'snapshots'} to frames`
  return result.unlinked === 0
    ? `${linked}.`
    : `${linked}; ${result.unlinked} ${result.unlinked === 1 ? 'snapshot has' : 'snapshots have'} no frame with a matching name.`
}

// ---- Server state -----------------------------------------------------------------------------

const base = (org: string) => `/api/orgs/${seg(org)}/integrations/figma`
const projectBase = (org: string, project: string) => `${base(org)}/projects/${seg(project)}`

export const figmaPageQuery = (org: string) =>
  queryOptions({
    queryKey: ['integrations', org, 'figma'],
    queryFn: () => getJson<Figma.Page>(base(org)),
  })

export const figmaLinksQuery = (org: string, project: string) =>
  queryOptions({
    queryKey: ['integrations', org, 'figma', 'links', project],
    queryFn: () => getJson<Figma.Links>(`${projectBase(org, project)}/links`),
  })

export function useConnectFigma(org: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => post<{ id: string }>(base(org), { token: token.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations', org] }),
  })
}

/** Chooses or clears the Figma file of a project. */
export function useFigmaFile(org: string) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['integrations', org] })
  return {
    set: useMutation({
      mutationFn: (input: { project: string; file: string }) =>
        send<unknown>('PUT', projectBase(org, input.project), { file: input.file.trim() }),
      onSuccess: refresh,
    }),
    clear: useMutation({
      mutationFn: (project: string) => send<undefined>('DELETE', projectBase(org, project)),
      onSuccess: refresh,
    }),
  }
}

/** A project's links: add one by hand, remove one, or link by name. */
export function useFigmaLinks(org: string) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['integrations', org, 'figma'] })
  return {
    create: useMutation({
      mutationFn: (input: { project: string; pattern: string; url: string }) =>
        post<Figma.Link>(`${projectBase(org, input.project)}/links`, {
          pattern: input.pattern.trim(),
          url: input.url.trim(),
        }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (input: { project: string; id: string }) =>
        send<undefined>('DELETE', `${projectBase(org, input.project)}/links/${seg(input.id)}`),
      onSuccess: refresh,
    }),
    auto: useMutation({
      mutationFn: (project: string) =>
        post<Figma.AutoLinkResult>(`${projectBase(org, project)}/auto-link`, {}),
      onSuccess: refresh,
    }),
  }
}

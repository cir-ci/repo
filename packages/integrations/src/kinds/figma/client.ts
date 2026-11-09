import { asRecord, items, str } from '@circi/core'

import { ProviderApiError } from '#src/git/provider.ts'
import { createHttpClient, type HttpClient } from '#src/http.ts'

/**
 * Figma's REST API (https://www.figma.com/developers/api), with a personal access token or an
 * OAuth token. Not a git host, so not a `GitProvider`: the token belongs to one integration and
 * is passed to every call (the caller opens it with `openSecret`; this file never sees the
 * instance secret).
 *
 * Node ids are the API's `12:34` form. Rendering frames (`renderFrames`) and comments
 * (`postComment`) are here for the design-compare and result-posting steps; linking uses only
 * `me`, `getFile`, `listFrames` and `getNodeNames`.
 */

export interface FigmaClientOptions {
  /** Default `https://api.figma.com`. */
  apiUrl?: string
  /** Replaceable in tests. */
  fetch?: typeof fetch
}

export class FigmaApiError extends ProviderApiError {
  constructor(status: number, message: string, options: { revoked?: boolean } = {}) {
    super(status, message, options)
    this.name = 'FigmaApiError'
  }
}

export namespace FigmaClient {
  export interface Me {
    /** Figma's user id. */
    id: string
    handle: string
    email: string | null
  }

  export interface Page {
    id: string
    name: string
  }

  export interface File {
    name: string
    pages: Page[]
  }

  export interface Frame {
    id: string
    name: string
    /** The page it is on. */
    page: string
  }

  export interface RenderOptions {
    scale?: number
  }

  export interface CommentInput {
    message: string
    /** Pins the comment on a frame (top-left corner unless `offset` says otherwise). */
    nodeId?: string
    offset?: { x: number; y: number }
  }
}

/** Node types that are screens a snapshot can be compared with. */
const FRAME_TYPES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET'])

interface RawNode {
  id: string
  name: string
  type: string | undefined
  children: RawNode[]
}

/** A node as the API sends it, down to the children one level below (`depth=1`). */
function node(value: unknown): RawNode {
  const r = asRecord(value)
  return {
    id: str(r.id),
    name: str(r.name),
    type: typeof r.type === 'string' ? r.type : undefined,
    children: items(r.children).map(node),
  }
}

/** A Personal access token is sent as `X-Figma-Token`; anything else is an OAuth bearer token. */
export const figmaAuthHeaders = (token: string): Record<string, string> =>
  token.startsWith('figd_') ? { 'X-Figma-Token': token } : { Authorization: `Bearer ${token}` }

export class FigmaClient {
  readonly kind = 'figma'
  readonly #apiUrl: string
  readonly #http: HttpClient

  constructor(options: FigmaClientOptions = {}) {
    this.#apiUrl = (options.apiUrl ?? 'https://api.figma.com').replace(/\/+$/, '')
    this.#http = createHttpClient({
      baseUrl: this.#apiUrl,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      // Figma has never had a timeout here: keep it so.
      timeoutMs: 0,
      unreachable: (err) => new FigmaApiError(0, `Figma could not be reached: ${String(err)}`),
      fail: ({ status, text, data }) => {
        const message = Reflect.get(Object(data), 'message') ?? Reflect.get(Object(data), 'err')
        const reason = typeof message === 'string' ? message : text
        // A token Figma no longer accepts: retrying cannot help until a person replaces it.
        return new FigmaApiError(status, `Figma answered ${status} ${reason}`.trim(), {
          revoked: status === 401 || (status === 403 && /token/i.test(reason)),
        })
      },
    })
  }

  async #call(
    token: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const { data } = await this.#http.request(method, path, {
      headers: figmaAuthHeaders(token),
      ...(body === undefined ? {} : { body }),
    })
    return asRecord(data)
  }

  /** Who the token belongs to; also proves the token works. */
  async me(token: string): Promise<FigmaClient.Me> {
    const r = await this.#call(token, 'GET', '/v1/me')
    const id = str(r.id)
    return { id, handle: str(r.handle, id), email: typeof r.email === 'string' ? r.email : null }
  }

  /** A file's name and its pages (no node tree below them). */
  async getFile(token: string, fileKey: string): Promise<FigmaClient.File> {
    const r = await this.#call(token, 'GET', `/v1/files/${encodeURIComponent(fileKey)}?depth=1`)
    return {
      name: str(r.name),
      pages: node(r.document).children.map((p) => ({ id: p.id, name: p.name })),
    }
  }

  async #nodes(
    token: string,
    fileKey: string,
    ids: string[],
    depth: number,
  ): Promise<Map<string, RawNode>> {
    if (ids.length === 0) return new Map()
    const qs = `ids=${encodeURIComponent(ids.join(','))}&depth=${depth}`
    const r = await this.#call(token, 'GET', `/v1/files/${encodeURIComponent(fileKey)}/nodes?${qs}`)
    // A node that doesn't exist comes back as null: leave it out.
    return new Map(
      Object.entries(asRecord(r.nodes)).flatMap(([id, n]) => {
        const document = asRecord(n).document
        return document === undefined ? [] : [[id, node(document)] as const]
      }),
    )
  }

  /** The top-level frames of every page, in page order. */
  async listFrames(token: string, fileKey: string): Promise<FigmaClient.Frame[]> {
    const file = await this.getFile(token, fileKey)
    const nodes = await this.#nodes(
      token,
      fileKey,
      file.pages.map((p) => p.id),
      1,
    )
    return file.pages.flatMap((page) =>
      (nodes.get(page.id)?.children ?? [])
        .filter((n) => n.type !== undefined && FRAME_TYPES.has(n.type))
        .map((n) => ({ id: n.id, name: n.name, page: page.name })),
    )
  }

  /** The names of the given nodes; a node that doesn't exist is left out. */
  async getNodeNames(
    token: string,
    fileKey: string,
    nodeIds: string[],
  ): Promise<Record<string, string>> {
    const nodes = await this.#nodes(token, fileKey, nodeIds, 1)
    return Object.fromEntries([...nodes].map(([id, n]) => [id, n.name]))
  }

  /** PNG renders of frames: a map of node id to a temporary image address (null when Figma could not render it). */
  async renderFrames(
    token: string,
    fileKey: string,
    nodeIds: string[],
    options: FigmaClient.RenderOptions = {},
  ): Promise<Record<string, string | null>> {
    const qs = `ids=${encodeURIComponent(nodeIds.join(','))}&format=png&scale=${options.scale ?? 1}`
    const r = await this.#call(token, 'GET', `/v1/images/${encodeURIComponent(fileKey)}?${qs}`)
    return Object.fromEntries(
      Object.entries(asRecord(r.images)).map(([id, url]) => [
        id,
        typeof url === 'string' ? url : null,
      ]),
    )
  }

  /** Comments on a file, pinned to a frame when `nodeId` is given. Returns the comment's id. */
  async postComment(
    token: string,
    fileKey: string,
    input: FigmaClient.CommentInput,
  ): Promise<string> {
    const r = await this.#call(token, 'POST', `/v1/files/${encodeURIComponent(fileKey)}/comments`, {
      message: input.message,
      ...(input.nodeId
        ? {
            client_meta: {
              node_id: input.nodeId,
              node_offset: input.offset ?? { x: 0, y: 0 },
            },
          }
        : {}),
    })
    return str(r.id)
  }
}

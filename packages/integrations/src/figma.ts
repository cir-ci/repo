import { FIGMA_FRAME_LINK_KIND, figmaFrameUrl, parseFigmaFileRef, parseFigmaUrl } from '@circi/core'
import { FigmaApiError, FigmaClient } from '@circi/providers'
import { z } from 'zod'

import { defineIntegration } from './define.ts'
import type { IntegrationDefinition } from './definition.ts'
import {
  IntegrationUnreachableError,
  InvalidCredentialsError,
  InvalidInputError,
} from './errors.ts'

/**
 * Figma: connected with an access token (verified with `/v1/me`); a project maps to the Figma FILE
 * it is designed in, and keeps a table of links from snapshot-name patterns to that file's frames
 * (`links`, rendered by the generic page; "Link automatically" matches names). The client is in
 * `@circi/providers`, the address parsing and name matching in `@circi/core`. The stored
 * credential is the token itself.
 */

const clientOf = (ctx: IntegrationDefinition.Context) =>
  new FigmaClient(ctx.fetch ? { fetch: ctx.fetch } : {})

/** A frame as a link: the node, its address and the name Figma gave it. */
function frameLink(
  fileKey: string,
  nodeId: string,
  title?: string,
): IntegrationDefinition.LinkDraft {
  return {
    ref: `${fileKey}:${nodeId}`,
    url: figmaFrameUrl(fileKey, nodeId),
    ...(title ? { title } : {}),
    payload: { fileKey, nodeId },
  }
}

export const figma = defineIntegration({
  id: 'figma',
  group: 'design',
  name: 'Figma',
  description: 'Link snapshots to frames, compare with the design, and post results on frames.',
  logo: 'figma',
  pageStyle: 'generic',
  credentials: z.object({
    token: z.string().trim().min(8).max(500).meta({
      label: 'Access token',
      secret: true,
      description: 'A personal access token (Figma: Settings, Security) that can read your files.',
      placeholder: 'figd_…',
    }),
  }),

  async connect(input, ctx) {
    try {
      const me = await clientOf(ctx).me(input.token)
      return { externalId: me.id, displayName: me.handle, credentials: input.token }
    } catch (err) {
      if (err instanceof FigmaApiError && err.revoked) {
        throw new InvalidCredentialsError('Figma rejected the token', { cause: err })
      }
      throw new IntegrationUnreachableError('Figma did not answer; try again shortly', {
        cause: err,
      })
    }
  },

  needsAttention: (err) =>
    err instanceof FigmaApiError && err.revoked
      ? 'The access token was rejected. Remove Figma and connect it again with a new token.'
      : null,

  events: [],

  capabilities: {
    design: {
      listFrames: (credentials, fileRef, ctx) => clientOf(ctx).listFrames(credentials, fileRef),
      render: (credentials, fileRef, nodeIds, ctx) =>
        clientOf(ctx).renderFrames(credentials, fileRef, [...nodeIds]),
      comment: (credentials, fileRef, input, ctx) =>
        clientOf(ctx).postComment(credentials, fileRef, input),
      linkFor: (fileRef, frame) => frameLink(fileRef, frame.id, frame.name),
    },
  },

  mapping: {
    description:
      'Choose the Figma file each project is designed in. A project without a file does not use Figma.',
    target: {
      label: 'File',
      kind: 'text',
      placeholder: 'https://www.figma.com/design/…',
      validate: (ref) => (parseFigmaFileRef(ref) ? null : 'That is not a Figma file address'),
      async resolve(ref, input, ctx) {
        const fileKey = parseFigmaFileRef(ref)
        if (!fileKey) throw new InvalidInputError('That is not a Figma file address')
        try {
          const file = await clientOf(ctx).getFile(input.credentials, fileKey)
          return { ref: fileKey, name: file.name }
        } catch (err) {
          if (err instanceof FigmaApiError && !err.revoked) {
            if (err.status === 404) throw new InvalidInputError('Figma could not find that file')
            if (err.status === 403) {
              throw new InvalidInputError('The token has no access to that file')
            }
          }
          throw err
        }
      },
    },
  },

  links: {
    kind: FIGMA_FRAME_LINK_KIND,
    label: 'Frame links',
    description:
      'Link snapshots to the frames they implement. The frame shows in the build review, next to the snapshot.',
    targetLabel: 'Frame',
    subject: 'pattern',
    fields: [
      {
        key: 'pattern',
        label: 'Snapshot name',
        placeholder: 'checkout/*',
        description: 'A name, or a pattern: * matches within a folder, ** across folders.',
      },
      {
        key: 'url',
        label: 'Frame address',
        placeholder: 'https://www.figma.com/design/…?node-id=12-34',
        description: 'In Figma, select the frame and choose Copy link to selection.',
      },
    ],
    autoLink: true,
    async resolve(values, input, ctx) {
      const target = parseFigmaUrl(values.url ?? '')
      if (!target?.nodeId) {
        throw new InvalidInputError(
          'Paste the address of a frame (Copy link to selection in Figma)',
        )
      }
      // The frame's name is a courtesy: a link made while Figma is down still stands.
      const names = await clientOf(ctx)
        .getNodeNames(input.credentials, target.fileKey, [target.nodeId])
        .catch((): Record<string, string> => ({}))
      return frameLink(target.fileKey, target.nodeId, names[target.nodeId])
    },
  },
})

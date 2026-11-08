import { FIGMA_FRAME_LINK_KIND, figmaFrameUrl, globMatches, pickFigmaLink } from '@circi/core'

import { listProjectLinks } from '#repositories/integration-links.ts'
import type { Database } from '#src/client.ts'

export namespace figmaFramesForSnapshots {
  export interface Frame {
    fileKey: string
    /** `12:34`. */
    nodeId: string
    /** Opens the frame in Figma. */
    url: string
    /** The frame's name when CirCI has seen it. */
    frameName: string | null
  }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/**
 * The Figma frame each snapshot name is linked to, for the build review and the peek. A name
 * with several matching links gets the most specific one (manual beats automatic); a name with
 * none is left out of the map.
 */
export async function figmaFramesForSnapshots(
  db: Database,
  projectId: string,
  snapshotNames: readonly string[],
): Promise<Map<string, figmaFramesForSnapshots.Frame>> {
  const out = new Map<string, figmaFramesForSnapshots.Frame>()
  if (snapshotNames.length === 0) return out
  const links = (await listProjectLinks(db, projectId, FIGMA_FRAME_LINK_KIND)).flatMap((l) => {
    const fileKey = text(l.payload.fileKey)
    const nodeId = text(l.payload.nodeId)
    return fileKey && nodeId && l.subject
      ? [
          {
            snapshotPattern: l.subject,
            source: l.payload.source === 'auto' ? ('auto' as const) : ('manual' as const),
            fileKey,
            nodeId,
            frameName: l.title,
            createdAt: l.createdAt,
          },
        ]
      : []
  })
  if (links.length === 0) return out
  for (const name of snapshotNames) {
    const link = pickFigmaLink(links, name, globMatches)
    if (link) {
      out.set(name, {
        fileKey: link.fileKey,
        nodeId: link.nodeId,
        url: figmaFrameUrl(link.fileKey, link.nodeId),
        frameName: link.frameName,
      })
    }
  }
  return out
}

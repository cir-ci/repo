import { figmaFrameUrl, globMatches, pickFigmaLink } from '@circi/core'

import { listFigmaLinks } from '#repositories/figma.ts'
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
  const links = await listFigmaLinks(db, projectId)
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

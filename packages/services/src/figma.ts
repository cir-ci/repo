import { globMatches, matchFramesToSnapshots, openSecret, ValidationError } from '@circi/core'
import {
  type Database,
  deleteAutoFigmaLinks,
  findFigmaIntegration,
  getFigmaProjectFile,
  getProjectById,
  insertAutoFigmaLinks,
  listFigmaLinks,
  listProjectSnapshotNames,
  figmaFileExtra,
  rememberFigmaFrames,
  removeIntegrationProject,
  setIntegrationProject,
} from '@circi/db'

/**
 * Figma linking: which file a project is designed in, and which frame each snapshot is linked
 * to. The Figma client is passed in (anything with these methods; `FigmaClient` in
 * `@circi/providers`), so this package needs no HTTP of its own and tests hand it a fake.
 */

export interface FigmaFrames {
  listFrames(token: string, fileKey: string): Promise<{ id: string; name: string; page: string }[]>
}

export namespace autoLinkFigmaFrames {
  export interface Input {
    projectId: string
    /** The instance secret (`BETTER_AUTH_SECRET`), to open the stored token. */
    secret: string
    figma: FigmaFrames
    createdBy?: string | null
  }

  export interface Result {
    /** Links added now. */
    created: number
    /** Snapshots the project has uploaded that still have no frame. */
    unlinked: number
    /** Frames the file has. */
    frames: number
  }
}

async function figmaContext(db: Database, projectId: string, secret: string) {
  const project = await getProjectById(db, projectId)
  const integration = project ? await findFigmaIntegration(db, project.orgId) : undefined
  if (!project || !integration) throw new ValidationError('Figma is not connected')
  const file = await getFigmaProjectFile(db, integration.id, project.id)
  if (!file) throw new ValidationError('Choose a Figma file for this project first')
  const token = integration.encryptedCredentials
    ? openSecret(secret, integration.encryptedCredentials)
    : undefined
  if (!token)
    throw new ValidationError('The Figma token can no longer be read: connect Figma again')
  return { integration, file, token }
}

/**
 * Links the project's snapshots to frames of its Figma file by name (`matchFramesToSnapshots`
 * in `@circi/core`): case and separators ignored, then the frame named like the last path
 * segment; ambiguous names get no link. Only snapshots no link covers yet are considered, and
 * an existing link (manual or automatic) is never replaced. Frame names are remembered so links
 * can show them.
 */
export async function autoLinkFigmaFrames(
  db: Database,
  input: autoLinkFigmaFrames.Input,
): Promise<autoLinkFigmaFrames.Result> {
  const { integration, file, token } = await figmaContext(db, input.projectId, input.secret)
  const frames = await input.figma.listFrames(token, file.fileKey)
  const [names, existing] = await Promise.all([
    listProjectSnapshotNames(db, input.projectId),
    listFigmaLinks(db, input.projectId),
  ])
  const uncovered = names.filter((n) => !existing.some((l) => globMatches(l.snapshotPattern, n)))
  const matches = matchFramesToSnapshots(
    frames.map((f) => f.name),
    uncovered,
  )
  return db.transaction(async (tx) => {
    const created = await insertAutoFigmaLinks(
      tx,
      matches.flatMap((m) => {
        const frame = frames[m.frameIndex]
        return frame
          ? [
              {
                integrationId: integration.id,
                projectId: input.projectId,
                snapshotPattern: m.snapshotName,
                fileKey: file.fileKey,
                nodeId: frame.id,
                createdBy: input.createdBy ?? null,
              },
            ]
          : []
      }),
    )
    await rememberFigmaFrames(tx, {
      integrationId: integration.id,
      projectId: input.projectId,
      frames: Object.fromEntries(frames.map((f) => [f.id, f.name])),
      frameCount: frames.length,
    })
    return { created, unlinked: uncovered.length - created, frames: frames.length }
  })
}

export namespace setFigmaFile {
  export interface Input {
    projectId: string
    orgId: string
    integrationId: string
    fileKey: string
    /** The file's name, as Figma reports it. */
    fileName: string
  }
}

/**
 * Points a project at a Figma file. Changing to another file drops the automatic links to the
 * old one (they would point at frames that aren't there); manual links stay, as a person made them.
 */
export async function setFigmaFile(db: Database, input: setFigmaFile.Input): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await getFigmaProjectFile(tx, input.integrationId, input.projectId)
    // Choosing the same file again keeps the frame names already learned.
    const keep = current?.fileKey === input.fileKey ? current.extra : undefined
    await setIntegrationProject(tx, {
      integrationId: input.integrationId,
      projectId: input.projectId,
      externalRef: input.fileKey,
      extra: { ...keep, ...figmaFileExtra(input.fileName) },
    })
    await deleteAutoFigmaLinks(tx, input.projectId, input.fileKey)
  })
}

/** Stops a project using Figma: forgets its file and its automatic links (manual ones stay for when a file is chosen again). */
export async function clearFigmaFile(
  db: Database,
  input: { projectId: string; integrationId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await removeIntegrationProject(tx, input.integrationId, input.projectId)
    await deleteAutoFigmaLinks(tx, input.projectId)
  })
}

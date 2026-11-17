import { and, eq } from 'drizzle-orm'

import { siteArtifactImports } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** The record of sites published from GitHub Actions artifacts: one row per workflow run attempt. */

export namespace findArtifactImport {
  export interface Row {
    status: 'published' | 'failed'
    artifactId: string | null
    message: string
  }
}

export async function findArtifactImport(
  db: Database,
  key: { projectId: string; runId: string; runAttempt: number },
): Promise<findArtifactImport.Row | undefined> {
  const [row] = await db
    .select({
      status: siteArtifactImports.status,
      artifactId: siteArtifactImports.artifactId,
      message: siteArtifactImports.message,
    })
    .from(siteArtifactImports)
    .where(
      and(
        eq(siteArtifactImports.projectId, key.projectId),
        eq(siteArtifactImports.runId, key.runId),
        eq(siteArtifactImports.runAttempt, key.runAttempt),
      ),
    )
  return row?.status === 'published' || row?.status === 'failed'
    ? { status: row.status, artifactId: row.artifactId, message: row.message }
    : undefined
}

/** Records how an attempt ended; a later outcome for the same attempt replaces the earlier one. */
export async function recordArtifactImport(
  db: Database,
  input: {
    projectId: string
    runId: string
    runAttempt: number
    status: 'published' | 'failed'
    artifactId?: string | undefined
    commitSha: string
    message: string
  },
): Promise<void> {
  const values = {
    projectId: input.projectId,
    runId: input.runId,
    runAttempt: input.runAttempt,
    status: input.status,
    artifactId: input.artifactId ?? null,
    commitSha: input.commitSha,
    message: input.message,
  }
  await db
    .insert(siteArtifactImports)
    .values(values)
    .onConflictDoUpdate({
      target: [
        siteArtifactImports.projectId,
        siteArtifactImports.runId,
        siteArtifactImports.runAttempt,
      ],
      set: {
        status: values.status,
        artifactId: values.artifactId,
        commitSha: values.commitSha,
        message: values.message,
        updatedAt: new Date(),
      },
    })
}

import type { Build } from '@circi/api'

import { Repo } from '#github/git-repo.ts'
import type { Stack } from '#stack/stack.ts'

import { approveBuild, createProject, type CreatedProject, type Session } from './admin.ts'
import { uploadOrThrow } from './upload.ts'

/** A project with an approved baseline on `main` and a pull request build waiting for review. */
export interface PendingBuildFixture {
  repo: Repo
  project: CreatedProject
  /** The pull request build's number (one changed screenshot, `login`). */
  buildNumber: number
  /** The pull request build's page, without the origin. */
  path: string
  /** The project's builds page, without the origin. */
  projectPath: string
  /** The content hash of the changed screenshot's new image (`/api/files/<sha256>`). */
  imageSha: string
  /** Uploads one more pull request build (a new commit moving the dot) and returns its number. */
  uploadAnother(pr: number): Promise<number>
  destroy(): Promise<void>
}

/**
 * What the dashboard cache tests look at: the real CLI uploads a baseline, which is approved, and
 * a changed build from a pull request, which is left pending. Everything goes through the real
 * CLI and API, so the screenshot links are the server's own signed ones.
 */
export async function seedPendingBuild(
  stack: Stack,
  session: Session,
  workspaceSlug: string,
  projectName: string,
): Promise<PendingBuildFixture> {
  const repo = await Repo.create()
  const project = await createProject(session, workspaceSlug, projectName)
  await repo.writeShots({ home: {}, login: { dot: { x: 40, y: 40 } } })
  await repo.commit('first')
  const baseline = await uploadOrThrow({ stack, token: project.token, repo, wait: true })
  await approveBuild(session, workspaceSlug, project.slug, baseline.build.number)

  await repo.checkout('feature', { create: true })
  const pending = async (pr: number, x: number): Promise<number> => {
    await repo.writeShots({ login: { dot: { x, y: 200 } } })
    await repo.commit(`move the button to ${x}`)
    const out = await uploadOrThrow({
      stack,
      token: project.token,
      repo,
      wait: true,
      pr: { number: pr },
    })
    return out.build.number
  }
  const buildNumber = await pending(12, 300)
  const projectPath = `/${workspaceSlug}/${project.slug}`
  const detail = await session.get<Build.Detail>(
    `/api/projects/${workspaceSlug}/${project.slug}/builds/${buildNumber}`,
  )
  const imageSha = detail.diffs.find((d) => d.name === 'login')?.head?.sha256
  if (!imageSha) throw new Error('the pending build has no head image for login')
  return {
    repo,
    project,
    buildNumber,
    path: `${projectPath}/builds/${buildNumber}`,
    projectPath,
    imageSha,
    uploadAnother: (pr) => pending(pr, 100 + pr * 10),
    destroy: () => repo.destroy(),
  }
}

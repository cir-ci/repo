import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Which end-to-end runs are alive, so a run can remove the stacks of runs that died without
 * cleaning up (a SIGKILL: turbo cancelling the sibling group, a killed terminal). Each run leaves
 * an owner file named by its run ID holding its process ID; the folder is machine-wide (the temp
 * folder, not the repo's .artifacts) so a run in one worktree never takes another worktree's live
 * stacks for leftovers.
 */
export const RUNS_DIR = join(tmpdir(), 'circi-e2e-runs')

/** `circi-e2e-<run>-<rest>` → `<run>`; undefined for a name that is not an e2e stack. */
export function runIdOf(project: string): string | undefined {
  return /^circi-e2e-([0-9a-z]+)-/.exec(project)?.[1]
}

export namespace abandonedProjects {
  /** What a run's owner file says: its process ID, or that its stacks are kept on purpose. */
  export type Owner = { pid: number } | 'keep'
}

/**
 * The stacks to remove: those whose run has no owner file, or whose owner process has exited.
 * A kept run's stacks (E2E_KEEP) stay until someone removes them.
 */
export function abandonedProjects(
  projects: readonly string[],
  owners: ReadonlyMap<string, abandonedProjects.Owner>,
  isAlive: (pid: number) => boolean,
): string[] {
  return projects.filter((project) => {
    const run = runIdOf(project)
    if (run === undefined) return false
    const owner = owners.get(run)
    if (owner === 'keep') return false
    return owner === undefined || !isAlive(owner.pid)
  })
}

/** Whether a process is running (signal 0 only checks; EPERM means it exists but isn't ours). */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Registers this run as the owner of its stacks. */
export function claimRun(runId: string): void {
  mkdirSync(RUNS_DIR, { recursive: true })
  writeFileSync(join(RUNS_DIR, runId), String(process.pid))
}

/** Ends this run's ownership: gone, or marked kept so later runs leave its stacks alone. */
export function releaseRun(runId: string, keep: boolean): void {
  if (keep) writeFileSync(join(RUNS_DIR, runId), 'keep')
  else rmSync(join(RUNS_DIR, runId), { force: true })
}

/** Every run's owner file. */
export function readOwners(): Map<string, abandonedProjects.Owner> {
  const owners = new Map<string, abandonedProjects.Owner>()
  let names: string[] = []
  try {
    names = readdirSync(RUNS_DIR)
  } catch {
    return owners
  }
  for (const name of names) {
    let text = ''
    try {
      text = readFileSync(join(RUNS_DIR, name), 'utf8').trim()
    } catch {
      continue
    }
    if (text === 'keep') owners.set(name, 'keep')
    else if (/^\d+$/.test(text)) owners.set(name, { pid: Number(text) })
  }
  return owners
}

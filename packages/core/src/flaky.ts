/**
 * Flaky screenshots and the merge gate. A flaky screenshot is one that keeps changing on the
 * default branch (it is a dashboard grouping: the build still lists it as changed). Whether a
 * pull request whose only changes are flaky ones holds the merge is a setting: the workspace
 * sets it, and a team may override it.
 */

/**
 * The effective "flaky screenshots block merges" value. The team's own value wins; `null`
 * means "inherit from the workspace".
 */
export function resolveFlakyBlocksMerge(workspace: boolean, team: boolean | null): boolean {
  return team ?? workspace
}

/** What a workspace says when it has never been asked: flaky changes block like any other. */
export const DEFAULT_FLAKY_BLOCKS_MERGE = true

/**
 * Whether the build's only differences are flaky screenshots: at least one change, nothing
 * added, removed or failed, and every changed screenshot is on the flaky list.
 */
export function onlyFlakyChanges(input: onlyFlakyChanges.Input): boolean {
  const { added, removed, changed, failed } = input.counts
  if (changed === 0 || added > 0 || removed > 0 || failed > 0) return false
  if (input.changed.length === 0) return false
  const flaky = new Set(input.flaky)
  return input.changed.every((name) => flaky.has(name))
}

export namespace onlyFlakyChanges {
  export interface Input {
    counts: { added: number; removed: number; changed: number; failed: number }
    /** Names of the screenshots whose status is `changed`. */
    changed: readonly string[]
    /** Names the team currently flags as flaky. */
    flaky: readonly string[]
  }
}

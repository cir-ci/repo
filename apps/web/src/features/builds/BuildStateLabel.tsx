import { StatusChip } from '@circi/ui'

import { type BuildState, screenState } from './build-state.ts'

/** A build's state as a chip: the glyph and the precise word (docs/design-gaps.md §8). */
export function BuildStateLabel({ build, hasBaseline = true }: BuildStateLabel.Props) {
  const state = screenState(build, hasBaseline)
  return <StatusChip status={state.status}>{state.label}</StatusChip>
}

export namespace BuildStateLabel {
  export interface Props {
    build: BuildState.Input
    /** `false` for a build with nothing to compare against: it reads "No baseline" while it awaits review. */
    hasBaseline?: boolean
  }
}

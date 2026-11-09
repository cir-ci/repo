import { diffImages, makeThumbnail, readPngInfo } from '@circi/diff'
import { processBuild as run } from '@circi/services'

/** The `process-build` job: the pipeline lives in `@circi/services`; this wires in the image functions. */
export async function processBuild(
  deps: Omit<processBuild.Deps, 'diff'>,
  buildId: string,
): Promise<processBuild.Result> {
  return run({ ...deps, diff: { diffImages, makeThumbnail, readPngInfo } }, buildId)
}

export namespace processBuild {
  export type Deps = run.Deps
  export type Result = run.Result
}

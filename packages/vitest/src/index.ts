import type { CirciOptions } from '@circi/cli'

export { type CollectedScreenshot, collectDirectory } from './collect.ts'
export { circi } from './plugin.ts'
export { CirciReporter } from './reporter.ts'
export { DEFAULT_DIR, settlePage, STABILIZE_CSS } from './screenshot.ts'
export { shardFromArgs } from '@circi/cli'

/** One shard of a parallel build: `index` is 0-based. */
export type Shard = CirciOptions.Shard

// This package's own tests (the retry reporter): Node tests like any package's.
import node from './vitest.node.config.ts'

export default node(import.meta.dirname)

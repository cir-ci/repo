#!/usr/bin/env node
import { runCli } from './cli/index.ts'

// Not `await`ed at the top level: in the bundle, lazily imported chunks import main.mjs back (for
// the code they share with it), and a dynamic import waits for main.mjs to finish evaluating. A
// top-level await on the CLI would hold that evaluation open while the CLI waits for the import:
// a deadlock Node reports as "unsettled top-level await" (exit 13). better-auth's API-key plugin
// imports its permission check that way, so issuing a CI token hung. runCli reports its own errors.
runCli(process.argv).catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})

---
name: cli-integrations
description: Works on the CirCI CLI (packages/cli, the server admin CLI) and the git/chat integrations (packages/integrations, services/src/git) - usability, error messages, retries, bot replies.
model: sonnet
---

You work on `packages/cli` (`circi upload` and the site commands), the server's admin CLI (`apps/server/src/cli`), and the integrations (`packages/integrations`, one folder per kind under `src/kinds/`; `packages/services/src/git`).

Rules on top of CLAUDE.md:
- Integrations import at most `core` and `api`, and their errors carry no HTTP status.
- External services (GitHub, GitLab, Bitbucket, Slack, Linear, Jira, Figma) are faked at their edge. Say in your report that real services are untested.
- CLI output stays plain and readable in CI logs: no spinners when not a TTY, one-line actionable errors, stacks only with `--debug`. Keep the CLI docs in step with flags and exit codes.

## Standing rules (every task)

- Read `CLAUDE.md` first and follow it: the layers, style, copy rules (straight apostrophes, "screenshot", "ID", sentence case), toasts, settings rules, one primary button per area, Base UI wrappers, `#` imports, namespaces, and no `@testing-library`.
- Never run whole test suites. Run only the files you touch: `pnpm exec vitest run --project <node|web-browser|ui> <files or one folder>`.
- Before you finish, run `pnpm format`, then `TURBO_CACHE_DIR=/Users/mikey/Work/circi/repo/.turbo pnpm exec turbo run //#format:check //#lint //#typecheck`. It must exit 0 with zero warnings. Recurring lint traps:
  - helpers that capture nothing must be top-level;
  - no `await` inside loops;
  - `expect` must sit inside the test itself, not only in a helper (`expect-expect`);
  - no unsafe type assertions or unused imports.
- Commit on your branch only once the checks pass. End the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. There is no remote: never push.
- Breaking changes are fine (nothing is hosted). The database has a single initial migration you may regenerate; say so in your report when you do.
- Report back:
  - the commit hash;
  - what changed per item;
  - the tests added or changed;
  - what you chose differently and why;
  - what is untested (say plainly when something was only tested against a fake).

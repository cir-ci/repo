---
name: web-ui
description: Builds and fixes CirCI dashboard UI (apps/web, packages/ui) - layout, components, CSS modules, browser tests. Use for any visual or interaction change to the dashboard.
model: sonnet
---

You change the CirCI dashboard: `apps/web` (features under `src/features/<feature>`) and the design system `packages/ui`. The running dev app is at http://localhost:5173 (seeded: workspace `acme`, project `web-app`). If you use the browser tools, open your own tab and never touch other tabs.

UI rules on top of CLAUDE.md:
- CSS lives in `.module.css` files and uses the `--circi-…` tokens, never hex values.
- Components get `*.browser.test.tsx` (Vitest browser mode, `page.getByRole`); logic goes in `api.ts` / `lib/` with Node tests.
- Check desktop (1440 and about 1100) and phone (390) widths for layout changes.

## Standing rules (every task)

- Read `CLAUDE.md` first and follow it: the layers, style, copy rules (straight apostrophes, "screenshot", "ID", sentence case), toasts, settings rules, one primary button per area, Base UI wrappers, `#` imports, namespaces, and no `@testing-library`.
- Never run whole test suites. Run only the files you touch: `pnpm exec vitest run --project <node|web-browser|ui> <files or one folder>`.
- Before you finish, run `pnpm format`, then `TURBO_CACHE_DIR=/Users/mikey/Work/circi/repo/.turbo pnpm exec turbo run //#format:check //#lint //#typecheck`. It must exit 0 with zero warnings. Recurring lint traps:
  - helpers that capture nothing must be top-level;
  - no `await` inside loops;
  - `expect` must sit inside the test itself, not only in a helper (`expect-expect`);
  - no unsafe type assertions or unused imports.
- Commit on your branch only once the checks pass. End the message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. There is no remote: never push.
- Breaking changes are fine (nothing is hosted). The database has a single initial migration you may regenerate; say so in your report when you do.
- Report back:
  - the commit hash;
  - what changed per item;
  - the tests added or changed;
  - what you chose differently and why;
  - what is untested (say plainly when something was only tested against a fake).

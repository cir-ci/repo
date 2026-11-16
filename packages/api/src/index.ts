/**
 * The dashboard API's wire format: what `/api/*` sends as JSON and `apps/web` reads. One
 * definition, shared by both sides, so a change can't typecheck on one and break the other.
 *
 * Types only, grouped in a namespace per resource (`Build.Detail`, `Project.Settings`…). Dates
 * are ISO strings here because that is what JSON carries. The server checks its read models
 * against these in `apps/server/src/contract-check.ts`.
 */

export * from './account.ts'
export * from './baseline.ts'
export * from './build.ts'
export * from './comment.ts'
export * from './figma.ts'
export * from './flaky.ts'
export * from './insights.ts'
export * from './instance.ts'
export * from './instance-admin.ts'
export * from './integration.ts'
export * from './issue.ts'
export * from './live.ts'
export * from './notification.ts'
export * from './push.ts'
export * from './workspace.ts'
export * from './project.ts'
export * from './review.ts'
export * from './search.ts'
export * from './site.ts'
export * from './triage.ts'
export * from './undo.ts'
export * from './sidebar.ts'
export * from './storage.ts'
export * from './view.ts'

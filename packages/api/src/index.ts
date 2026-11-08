/**
 * The dashboard API's wire format: what `/api/*` sends as JSON and `apps/web` reads. One
 * definition, shared by both sides, so a change can't typecheck on one and break the other.
 *
 * Types only, grouped in a namespace per resource (`Build.Detail`, `Project.Settings`…). Dates
 * are ISO strings here because that is what JSON carries. The server checks its read models
 * against these in `apps/server/src/contract-check.ts`.
 */

export * from './baseline.ts'
export * from './build.ts'
export * from './flaky.ts'
export * from './insights.ts'
export * from './instance.ts'
export * from './org.ts'
export * from './project.ts'
export * from './review.ts'
export * from './site.ts'
export * from './triage.ts'

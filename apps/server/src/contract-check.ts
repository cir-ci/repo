import type { Build, Project } from '@circi/api'
import type { BuildDetail, BuildListItem, ProjectOverview, VisibleProject } from '@circi/db'

/**
 * Compile-time proof that what the server's read models produce fits the wire format in
 * `@circi/api` once JSON has turned its dates into strings. If a field is renamed, retyped or
 * dropped on one side, this file stops typechecking. Nothing here exists at runtime.
 */

type Json<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T

/** `true` when `Actual` is usable wherever `Wire` is expected; a type error otherwise. */
type Fits<Actual, Wire> = [Actual] extends [Wire] ? true : never

export type ContractChecks = [
  Fits<Json<BuildListItem>, Build.ListItem>,
  Fits<Json<ProjectOverview>, Project.Overview>,
  Fits<VisibleProject, Project.Info>,
  Fits<Json<BuildDetail>['diffs'], Build.DiffItem[]>,
  Fits<Json<BuildDetail>['reviews'], Build.Review[]>,
  Fits<Json<BuildDetail>['build'], Omit<Build.Detail['build'], never>>,
]

/** Each entry must be `true`; a mismatch above makes its entry `never`, and this line fails. */
export const contractChecks: ContractChecks = [true, true, true, true, true, true]

/**
 * The integration SDK: one `IntegrationDefinition` per integration, one registry, and the generic
 * pieces (catalog, mapping rules, errors) the server, the worker and the services build on.
 * See the package's README.md.
 */
export { defineIntegration, definitionProblems } from '#src/sdk/define.ts'
export type { EventsField, IntegrationDefinition } from '#src/sdk/definition.ts'
export {
  IntegrationConflictError,
  IntegrationError,
  type IntegrationErrorCode,
  IntegrationNotFoundError,
  IntegrationUnreachableError,
  InvalidCredentialsError,
  InvalidInputError,
} from '#src/sdk/errors.ts'
export { derivedWebhookSecret } from '#src/git/support.ts'
export {
  mappedEvents,
  mappingExtraSchema,
  mappingHandles,
  normalizeExtra,
} from '#src/sdk/mapping.ts'
export {
  buildCatalog,
  credentialFields,
  describeDefinition,
  linksSpec,
  mappingSpec,
} from '#src/sdk/public.ts'
export { IntegrationRegistry, integrationRegistry } from '#src/sdk/registry.ts'
export { resolveKind } from '#src/sdk/resolve.ts'

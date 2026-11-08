/**
 * The integration SDK: one `IntegrationDefinition` per integration, one registry, and the generic
 * pieces (catalog, mapping rules, errors) the server, the worker and the services build on.
 * See docs/integration-sdk.md.
 */
export { defineIntegration, definitionProblems } from './define.ts'
export type { EventsField, IntegrationDefinition } from './definition.ts'
export {
  IntegrationConflictError,
  IntegrationError,
  IntegrationNotFoundError,
  IntegrationUnreachableError,
  InvalidCredentialsError,
  InvalidInputError,
} from './errors.ts'
export { derivedWebhookSecret } from './git-support.ts'
export { mappedEvents, mappingExtraSchema, mappingHandles, normalizeExtra } from './mapping.ts'
export {
  buildCatalog,
  credentialFields,
  describeDefinition,
  linksSpec,
  mappingSpec,
} from './public.ts'
export { IntegrationRegistry, integrationRegistry } from './registry.ts'
export { resolveKind } from './resolve.ts'

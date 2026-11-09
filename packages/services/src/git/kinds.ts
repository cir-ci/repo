import { integrationRegistry } from '@circi/integrations'

/** The ids of the integration kinds that are git hosts, for the repositories' queries. */
export const gitKinds = (): string[] => integrationRegistry.gitKinds()

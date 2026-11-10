import { isValidSlug, NotFoundError, slugify, ValidationError } from '@circi/core'
import { type Database } from '@circi/db'
import { getIntegration, listIntegrations, listTeams } from '@circi/db/queries'
import { createTeam, listIntegrationTeams } from '@circi/db/repositories'
import {
  type IntegrationDefinition,
  IntegrationError,
  IntegrationUnreachableError,
  integrationRegistry,
  InvalidInputError,
} from '@circi/integrations'

import { mapTeam } from '#src/integration-admin/links.ts'

/**
 * Importing a workspace's GitHub repositories as teams ("Import from GitHub" on the Teams page):
 * the repositories the App's installation can see that no team is linked to yet, and one new team
 * per picked repository. A team is named after the repository (`acme/web-app` becomes `web-app`,
 * or `acme-web-app` when that address is taken), points at it, and has the person importing as its
 * member. The teams get no CI token: it is issued from the team's settings when its CI is set up.
 */

const MAX_IMPORT = 50

export namespace listImportableRepositories {
  /** A repository the installation can see and no team is linked to. */
  export interface Item {
    /** The workspace's GitHub connection that sees it. */
    integration: string
    /** That connection's name (`Installation 42`). */
    installation: string
    /** `owner/name`. */
    ref: string
    private: boolean
  }
}

function githubProvider(ctx: IntegrationDefinition.Context) {
  const provider = integrationRegistry.get('github')?.capabilities.git?.provider(ctx)
  if (!provider) throw new InvalidInputError('This instance has no GitHub App configured')
  return provider
}

/** The unlinked repositories of every GitHub installation the workspace has, by name. */
export async function listImportableRepositories(
  db: Database,
  input: { workspaceId: string; ctx: IntegrationDefinition.Context },
): Promise<listImportableRepositories.Item[]> {
  const installations = (await listIntegrations(db, input.workspaceId)).filter(
    (i) => i.kind === 'github',
  )
  if (installations.length === 0) {
    throw new NotFoundError("GitHub isn't connected to this workspace")
  }
  const provider = githubProvider(input.ctx)
  const items: listImportableRepositories.Item[] = []
  for (const installation of installations) {
    // eslint-disable-next-line no-await-in-loop -- a workspace has a handful of installations
    const stored = await getIntegration(db, input.workspaceId, installation.id)
    if (!stored) continue
    // eslint-disable-next-line no-await-in-loop
    const [repositories, mapped] = await Promise.all([
      provider.listRepositories(stored.externalId).catch((err: unknown) => {
        // The definition's own errors keep their status; anything else is GitHub not answering.
        if (err instanceof IntegrationError) throw err
        throw new IntegrationUnreachableError("GitHub didn't answer; try again shortly", {
          cause: err,
        })
      }),
      listIntegrationTeams(db, installation.id),
    ])
    const linked = new Set(mapped.map((m) => m.externalRef.toLowerCase()))
    for (const r of repositories) {
      if (linked.has(r.ref.toLowerCase())) continue
      items.push({
        integration: installation.id,
        installation: installation.displayName,
        ref: r.ref,
        private: r.private,
      })
    }
  }
  return items.toSorted((a, b) => a.ref.localeCompare(b.ref))
}

export namespace importGithubRepositories {
  export interface Input {
    workspaceId: string
    workspaceSlug: string
    /** The person importing: a member of every team made. */
    userId: string
    repositories: { integration: string; ref: string }[]
    ctx: IntegrationDefinition.Context
  }

  export interface Team {
    slug: string
    name: string
    repository: string
  }

  export interface Result {
    teams: Team[]
  }
}

/**
 * One team per picked repository, all or nothing: a repository that isn't an unlinked one of the
 * workspace's installations (`ValidationError`) or a team address that can't be made is refused
 * before anything is written, and the teams and their links are created in one transaction.
 */
export async function importGithubRepositories(
  db: Database,
  input: importGithubRepositories.Input,
): Promise<importGithubRepositories.Result> {
  if (input.repositories.length === 0) throw new ValidationError('Choose a repository to import')
  if (input.repositories.length > MAX_IMPORT) {
    throw new ValidationError(`Import at most ${MAX_IMPORT} repositories at a time`)
  }
  const importable = await listImportableRepositories(db, input)
  const picked = new Map<string, listImportableRepositories.Item>()
  for (const wanted of input.repositories) {
    const found = importable.find(
      (r) =>
        r.integration === wanted.integration && r.ref.toLowerCase() === wanted.ref.toLowerCase(),
    )
    if (!found) throw new ValidationError(`${wanted.ref} isn't a repository left to import`)
    picked.set(`${found.integration}/${found.ref.toLowerCase()}`, found)
  }

  const taken = new Set((await listTeams(db, input.workspaceSlug)).map((t) => t.slug))
  const plan = [...picked.values()].map((repo) => {
    const [owner = '', name = repo.ref] = repo.ref.split('/')
    const slug = [slugify(name), slugify(`${owner}-${name}`)].find(
      (s) => isValidSlug(s) && !taken.has(s),
    )
    if (!slug) {
      throw new ValidationError(`There is no free team address for ${repo.ref}; create it by hand`)
    }
    taken.add(slug)
    return { repo, name, slug }
  })

  const definition = integrationRegistry.get('github')
  if (!definition) throw new Error('GitHub is not registered')
  return db.transaction(async (tx) => {
    const teams: importGithubRepositories.Team[] = []
    for (const { repo, name, slug } of plan) {
      // eslint-disable-next-line no-await-in-loop -- one transaction, in order
      const team = await createTeam(tx, {
        workspaceSlug: input.workspaceSlug,
        name,
        slug,
        createdBy: input.userId,
      })
      // eslint-disable-next-line no-await-in-loop -- the same service every repository link uses
      await mapTeam(tx, {
        definition,
        integrationId: repo.integration,
        teamId: team.id,
        ref: repo.ref,
        extra: { name: repo.ref },
      })
      teams.push({ slug: team.slug, name: team.name, repository: repo.ref })
    }
    return { teams }
  })
}

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

import { describe, expect, it } from 'vitest'

import { RATCHET, type RuleId } from './layers.ratchet.ts'

/**
 * Layer tests: who may import whom (docs/architecture-review/layering.md section 4).
 *
 * Every rule below scans the source files of its scope and asserts on the PARSED import
 * specifiers (`import … from '…'`, `export … from '…'`, `import '…'` and `import('…')`), never on
 * substrings. `imports()` resolves each specifier to a normalised target: a `#alias/*` or a
 * relative path becomes a repo-relative file path (and a package name when it crosses into
 * another package), `@circi/x/sub` becomes the package `@circi/x`, anything else is the npm
 * package or `node:` builtin. Names imported from `@circi/db` are classified against the
 * barrel: a name exported by `db/src/repositories` is a repository function, one from
 * `db/src/queries` is a read model (allowed in routes). Type-only imports
 * (`import type { Database } from '@circi/db'`) are ignored by the rules that say `typeOnlyOk`.
 *
 * THE RATCHET. A rule is either ENFORCED (`ENFORCED` below: must find no offender) or RATCHETED:
 * it does not hold yet, and `layers.ratchet.ts` lists the files that break it today
 * (rule id -> repo-relative paths). The ratchet test fails in BOTH directions:
 *   - a file that breaks the rule and is not listed is a NEW offender: fix the file, never add it;
 *   - a listed file that no longer breaks the rule is STALE: delete the entry in the same change
 *     that fixed it, so the list only ever shrinks.
 * When a rule's list is empty, move the rule from RATCHETED to ENFORCED (step 10 of the plan).
 * `LAYERS_PRINT=1 pnpm vitest run packages/services/test/layers.test.ts` prints the current
 * offenders per rule (one JSON line), to compare with the ratchet file.
 */

const root = join(import.meta.dirname, '../../..')
const repositories = join(import.meta.dirname, '../../db/src/repositories')

/** The files that write to the job queue on behalf of others: the outbox itself. */
const OUTBOX = new Set(['jobs.ts', 'webhooks.ts', 'git.ts'])

const sourcesOf = (dir: string) =>
  readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ file: join(dir, f), text: readFileSync(join(root, dir, f), 'utf8') }))

// ---- parsing ---------------------------------------------------------------------------------

/** Removes comments (keeping strings), so a mention in a doc comment is not an import. */
function stripComments(text: string): string {
  return text.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)/g,
    (m, str: string | undefined) => str ?? '',
  )
}

interface ParsedImport {
  /** The specifier as written. */
  spec: string
  /** `import type …`, `export type … from`, or every named specifier marked `type`. */
  typeOnly: boolean
  /** Imported value names (`{ a, b as c }` gives a, b); `*` for a namespace import. */
  names: string[]
}

function parseClause(clause: string): { typeOnly: boolean; names: string[] } {
  const c = clause.trim()
  if (/^type\s/.test(c)) return { typeOnly: true, names: [] }
  const names: string[] = []
  let allType = true
  const braces = /\{([^}]*)\}/.exec(c)
  const outside = c.replace(/\{[^}]*\}/, '').replace(/[,\s]/g, '')
  if (outside !== '') {
    allType = false
    names.push(outside.startsWith('*') ? '*' : outside)
  }
  for (const part of (braces?.[1] ?? '').split(',')) {
    const t = part.trim()
    if (t === '') continue
    if (/^type\s/.test(t)) continue
    allType = false
    names.push((t.split(/\s+as\s+/)[0] ?? t).trim())
  }
  return { typeOnly: allType && (braces !== null || outside !== ''), names }
}

function parseImports(text: string): ParsedImport[] {
  const code = stripComments(text)
  const found: ParsedImport[] = []
  for (const m of code.matchAll(
    /\b(?:import|export)\s+([\w\s{},*$]*?)\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    found.push({ spec: m[2] ?? '', ...parseClause(m[1] ?? '') })
  }
  for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) {
    found.push({ spec: m[1] ?? '', typeOnly: false, names: [] })
  }
  for (const m of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    found.push({ spec: m[1] ?? '', typeOnly: false, names: ['*'] })
  }
  return found
}

// ---- resolving -------------------------------------------------------------------------------

/** `packages/db` / `apps/server` for a repo-relative file, and the `@circi/…` name of each. */
const packageDirs = ['apps', 'packages'].flatMap((group) =>
  readdirSync(join(root, group), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `${group}/${d.name}`),
)
const packageNames = new Map<string, string>()
const aliasesOf = new Map<string, [string, string][]>()
for (const dir of packageDirs) {
  try {
    const pkg: { name?: string; imports?: Record<string, string> } = JSON.parse(
      readFileSync(join(root, dir, 'package.json'), 'utf8'),
    )
    if (pkg.name) packageNames.set(pkg.name, dir)
    aliasesOf.set(
      dir,
      Object.entries(pkg.imports ?? {}).map(([k, v]) => [
        k.replace(/\*$/, ''),
        v.replace(/\*$/, ''),
      ]),
    )
  } catch {
    // a folder without a package.json is not a package
  }
}
const packageOfFile = (file: string) => packageDirs.find((d) => file.startsWith(`${d}/`))
const nameOfDir = (dir: string) => [...packageNames].find(([, d]) => d === dir)?.[0] ?? dir

interface Resolved extends ParsedImport {
  /** Repo-relative path, for `#alias` and relative specifiers. */
  file?: string
  /** `@circi/x`, or the npm package / `node:` builtin; for a file in another package, that package. */
  pkg?: string
}

function resolve(from: string, imp: ParsedImport): Resolved {
  const { spec } = imp
  let file: string | undefined
  if (spec.startsWith('.')) file = normalize(join(dirname(from), spec))
  else if (spec.startsWith('#')) {
    const owner = packageOfFile(from)
    const hit = (owner ? aliasesOf.get(owner) : undefined)?.find(([k]) => spec.startsWith(k))
    if (hit && owner) file = normalize(join(owner, hit[1], spec.slice(hit[0].length)))
  }
  if (file !== undefined) {
    const target = packageOfFile(file)
    return {
      ...imp,
      file,
      ...(target && target !== packageOfFile(from) ? { pkg: nameOfDir(target) } : {}),
    }
  }
  const parts = spec.split('/')
  const pkg = spec.startsWith('node:')
    ? spec
    : spec.startsWith('@')
      ? parts.slice(0, 2).join('/')
      : parts[0]
  return { ...imp, ...(pkg ? { pkg } : {}) }
}

const cache = new Map<string, { file: string; text: string; imports: Resolved[] }[]>()
/** Every non-test source file under `dir` with its resolved imports. */
function scan(dir: string) {
  let hit = cache.get(dir)
  if (!hit) {
    hit = sourcesOf(dir)
      .filter((f) => !/\.test\.tsx?$/.test(f.file))
      .map((f) =>
        Object.assign(f, { imports: parseImports(f.text).map((i) => resolve(f.file, i)) }),
      )
    cache.set(dir, hit)
  }
  return hit
}

/** `pkg` is `p`, or inside it (`@mui` also covers `@mui/material`). */
const isPackage = (i: Resolved, p: string) =>
  i.spec === p || i.spec.startsWith(`${p}/`) || i.pkg === p || (i.pkg?.startsWith(`${p}/`) ?? false)

// Package scopes are assembled so this file doesn't itself match a repo-wide grep for them.
const MUI = ['@', 'mui'].join('')
const EMOTION = ['@', 'emotion'].join('')
/** Files in `dir` importing any of `packages` (types too). */
const importsOf = (dir: string, packages: string[]) =>
  scan(dir)
    .filter((f) => f.imports.some((i) => packages.some((p) => isPackage(i, p))))
    .map((f) => f.file)

/** Files in the scopes with an import that `bad` accepts. */
const offendersOf = (
  dirs: string[],
  bad: (i: Resolved, file: string) => boolean,
  skip: (file: string) => boolean = () => false,
) =>
  dirs
    .flatMap((d) => scan(d))
    .filter((f) => !skip(f.file) && f.imports.some((i) => bad(i, f.file)))
    .map((f) => f.file)
    .toSorted()

// ---- what @circi/db exports, by layer --------------------------------------------------------

const exportedValues = (dir: string, only?: (file: string) => boolean) =>
  new Set(
    readdirSync(join(root, dir))
      .filter((f) => f.endsWith('.ts') && (only?.(f) ?? true))
      .flatMap((f) =>
        [
          ...stripComments(readFileSync(join(root, dir, f), 'utf8')).matchAll(
            /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+(\w+)/gm,
          ),
        ].map((m) => m[1] ?? ''),
      ),
  )
const REPOSITORY_FUNCTIONS = exportedValues('packages/db/src/repositories')
const QUEUE_FUNCTIONS = exportedValues('packages/db/src/repositories', (f) => OUTBOX.has(f))

/** The `@circi/db` entry the value import reaches (the barrel today, subpaths after step 6). */
const fromDb = (i: Resolved) =>
  i.pkg === '@circi/db' && !i.spec.startsWith('.') && !i.spec.startsWith('#')
const reachesRepositories = (i: Resolved) =>
  (/^@circi\/db\/(repositories|schema|queue)/.test(i.spec) ||
    /^packages\/db\/src\/(repositories|schema)\//.test(i.file ?? '') ||
    (fromDb(i) &&
      (i.names.includes('*') ||
        i.names.some((n) => n === 'schema' || REPOSITORY_FUNCTIONS.has(n))))) &&
  !i.typeOnly
const reachesQueue = (i: Resolved) =>
  (i.spec === '@circi/db/queue' || (fromDb(i) && i.names.some((n) => QUEUE_FUNCTIONS.has(n)))) &&
  !i.typeOnly

// ---- the rules -------------------------------------------------------------------------------

const HTTP = 'apps/server/src/http'
const ROUTES = 'apps/server/src/http/routes'
const TRANSPORT = [HTTP, 'apps/server/src/cli', 'apps/worker/src']
const ALL_SRC = packageDirs
  .map((d) => `${d}/src`)
  .filter((d) => {
    try {
      return readdirSync(join(root, d)).length > 0
    } catch {
      return false
    }
  })
const circi = (i: Resolved) => i.pkg?.startsWith('@circi/') === true
const notCore = (i: Resolved) => circi(i) && i.pkg !== '@circi/core'
const APPS = new Set(['@circi/worker', '@circi/server'])

/** Mutating repository functions, by verb (heuristic for rule 7). */
const MUTATING =
  /^(create|insert|update|set|delete|remove|record|add|mark|replace|upsert|claim|enqueue|finish|complete|fail|requeue|revoke|rotate|purge|restore|archive)/
const writesWithoutTx = (file: { text: string; imports: Resolved[] }) =>
  file.imports.some(
    (i) =>
      fromDb(i) &&
      !i.typeOnly &&
      i.names.some((n) => REPOSITORY_FUNCTIONS.has(n) && MUTATING.test(n)),
  ) && !/\btx\b|withTransaction|\btransaction\(/.test(stripComments(file.text))

const lines = (text: string) => text.split('\n').length

interface Rule {
  id: RuleId
  title: string
  offenders: () => string[]
}

const RULES: Rule[] = [
  {
    id: '1',
    title: 'core imports no @circi package, no node I/O, no drizzle-orm or pg',
    offenders: () =>
      offendersOf(
        ['packages/core/src'],
        (i) =>
          circi(i) ||
          // `isIP` is a pure string check: the one thing core takes from node:net.
          (/^node:(fs|net|http)/.test(i.spec) &&
            !(i.spec === 'node:net' && i.names.every((n) => n === 'isIP'))) ||
          ['drizzle-orm', 'pg'].some((p) => isPackage(i, p)),
      ),
  },
  {
    id: '2',
    title: 'providers, storage, sites, diff and config import at most core',
    offenders: () =>
      offendersOf(
        ['providers', 'storage', 'sites', 'diff', 'config'].map((p) => `packages/${p}/src`),
        notCore,
      ),
  },
  {
    id: '3',
    title: 'db imports none of services, integrations, providers, storage, auth, api',
    offenders: () =>
      offendersOf(['packages/db/src'], (i) =>
        ['services', 'integrations', 'providers', 'storage', 'auth', 'api'].some(
          (p) => i.pkg === `@circi/${p}`,
        ),
      ),
  },
  {
    id: '4',
    title: 'db read models (queries) do not import repositories',
    offenders: () =>
      offendersOf(['packages/db/src/queries'], (i) =>
        (i.file ?? '').startsWith('packages/db/src/repositories/'),
      ),
  },
  {
    id: '6',
    title: 'services import no app, fastify, auth, api, config, or drizzle sql/eq/and',
    offenders: () =>
      offendersOf(
        ['packages/services/src'],
        (i, file) =>
          APPS.has(i.pkg ?? '') ||
          i.spec.startsWith('apps/') ||
          isPackage(i, 'fastify') ||
          ['@circi/auth', '@circi/api', '@circi/config'].includes(i.pkg ?? '') ||
          (isPackage(i, 'drizzle-orm') &&
            !file.endsWith('/tx.ts') &&
            i.names.some((n) => ['sql', 'eq', 'and'].includes(n))),
      ),
  },
  {
    id: '7',
    title: 'a services file that calls a mutating repository function has a transaction in sight',
    offenders: () =>
      scan('packages/services/src')
        .filter(writesWithoutTx)
        .map((f) => f.file)
        .toSorted(),
  },
  {
    id: '8',
    title:
      'http, cli and worker import no repository, schema, queue, drizzle-orm or pg (types excepted)',
    offenders: () =>
      offendersOf(
        TRANSPORT,
        (i) =>
          reachesRepositories(i) ||
          (['drizzle-orm', 'pg'].some((p) => isPackage(i, p)) && !i.typeOnly),
      ),
  },
  {
    id: '9',
    title: 'http imports no app (the worker)',
    offenders: () => offendersOf([HTTP], (i) => i.pkg === '@circi/worker'),
  },
  {
    id: '9b',
    title: 'http does not touch the job queue (jobs, webhooks, git outbox): only services queue',
    offenders: () => offendersOf([HTTP], reachesQueue),
  },
  {
    id: '10',
    title: 'the worker imports repositories only in the claim loop (runner.ts)',
    offenders: () =>
      offendersOf(
        ['apps/worker/src'],
        reachesRepositories,
        (f) => f === 'apps/worker/src/runner.ts',
      ),
  },
  {
    id: '11',
    title: 'auth imports neither services nor an app',
    offenders: () =>
      offendersOf(
        ['packages/auth/src'],
        (i) => i.pkg === '@circi/services' || APPS.has(i.pkg ?? '') || i.spec.startsWith('apps/'),
      ),
  },
  {
    id: '12',
    title: 'integrations import neither db, services nor fastify',
    offenders: () =>
      offendersOf(['packages/integrations/src'], (i) =>
        ['@circi/db', '@circi/services', 'fastify'].some((p) => isPackage(i, p)),
      ),
  },
  {
    id: '12b',
    title: 'integration errors carry no HTTP status field',
    offenders: () =>
      scan('packages/integrations/src')
        .filter(
          (f) =>
            f.file.endsWith('/errors.ts') &&
            /\bstatus\s*[:?]|\bthis\.status\b/.test(stripComments(f.text)),
        )
        .map((f) => f.file),
  },
  {
    id: '13',
    title: 'process.env is read only in config, main.ts, runtime.ts, the CLIs and test tooling',
    offenders: () =>
      ALL_SRC.flatMap((d) => scan(d))
        .filter((f) => /\bprocess\.env\b/.test(stripComments(f.text)))
        .map((f) => f.file)
        .filter(
          (f) =>
            !/^packages\/(config|cli|testing|vitest)\//.test(f) &&
            !f.startsWith('apps/server/src/cli/') &&
            !/(^|\/)main\.ts$/.test(f) &&
            !/\/(lifecycle|composition)\/runtime\.ts$/.test(f),
        )
        .toSorted(),
  },
  {
    id: '14',
    title: 'routes decide no roles: no literal owner or admin',
    offenders: () =>
      scan(ROUTES)
        .filter((f) => /['"](owner|admin)['"]/.test(stripComments(f.text)))
        .map((f) => f.file)
        .toSorted(),
  },
  {
    id: '15',
    title: 'a route file stays under 250 lines',
    offenders: () =>
      scan(ROUTES)
        .filter((f) => lines(f.text) > 250)
        .map((f) => f.file)
        .toSorted(),
  },
]

/** Rules that hold today: no offender is allowed. The rest are ratcheted (see the top). */
const ENFORCED = new Set<RuleId>(['1', '2', '3', '6', '9', '11', '12'])

if (process.env.LAYERS_PRINT) {
  console.log(
    `LAYERS_JSON${JSON.stringify(Object.fromEntries(RULES.map((r) => [r.id, r.offenders()])))}`,
  )
}

describe('layers: dependency rules that hold', () => {
  for (const rule of RULES.filter((r) => ENFORCED.has(r.id))) {
    it(`rule ${rule.id}: ${rule.title}`, () => {
      expect(rule.offenders()).toEqual([])
    })
  }
})

describe('layers: ratchet (rules that do not hold yet; the lists in layers.ratchet.ts only shrink)', () => {
  for (const rule of RULES.filter((r) => !ENFORCED.has(r.id))) {
    it(`rule ${rule.id}: ${rule.title}`, () => {
      const found = rule.offenders()
      const allowed = RATCHET[rule.id] ?? []
      // A new offender is fixed, never added to the list; a fixed one is deleted from it.
      expect(
        found.filter((f) => !allowed.includes(f)),
        `NEW offenders of rule ${rule.id}: fix the file, do not add it to layers.ratchet.ts`,
      ).toEqual([])
      expect(
        allowed.filter((f) => !found.includes(f)),
        `STALE entries of rule ${rule.id}: delete them from layers.ratchet.ts`,
      ).toEqual([])
    })
  }
})

const named = (dir: string) =>
  readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' }).filter((f) =>
    /(github|gitlab|bitbucket|slack|linear|jira|figma)/i.test(f),
  )

describe('layers', () => {
  it('keeps repositories to storing data: only services queue jobs and notices', () => {
    const offenders = readdirSync(repositories)
      .filter((f) => f.endsWith('.ts') && !OUTBOX.has(f))
      .filter((f) =>
        /from '\.\/(jobs|webhooks|git)\.ts'/.test(readFileSync(join(repositories, f), 'utf8')),
      )
    // A repository that needs to trigger something must return what happened and let a
    // function in @circi/services do the triggering, inside its own transaction.
    expect(offenders).toEqual([])
  })
})

describe('the integration SDK', () => {
  it('keeps @circi/integrations free of the database, services and apps', () => {
    expect(
      importsOf('packages/integrations/src', ['@circi/db', '@circi/services', '@circi/worker']),
    ).toEqual([])
  })

  it('keeps the database, core and providers from importing the SDK', () => {
    expect(importsOf('packages/db/src', ['@circi/integrations'])).toEqual([])
    expect(importsOf('packages/core/src', ['@circi/integrations'])).toEqual([])
    expect(importsOf('packages/providers/src', ['@circi/integrations'])).toEqual([])
  })

  it('keeps the web app from importing definitions (it reads their public data from the API)', () => {
    expect(importsOf('apps/web/src', ['@circi/integrations'])).toEqual([])
  })

  it('has no integration route, job or page named after one integration in the generic files', () => {
    const generic = [
      'apps/server/src/http/routes/dashboard/integrations-generic.ts',
      'apps/server/src/http/routes/integration-webhook.ts',
      'packages/services/src/git-events.ts',
      'apps/web/src/features/integrations/GenericIntegrationPage.tsx',
    ]
    for (const file of generic) {
      expect(readFileSync(join(root, file), 'utf8')).not.toMatch(
        /slack|\bgithub\b|gitlab|bitbucket/i,
      )
    }
  })

  it('has no per-integration route, repository or page left: only definitions know a provider', () => {
    // `dashboard/github-app.ts` is the instance's GitHub App setup (the manifest flow): the
    // instance-level app an integration may need (docs/integration-sdk.md, "Adding an
    // integration" step 4), not a route that connects or maps anything.
    expect(
      named('apps/server/src/http/routes').filter((f) => f !== 'dashboard/github-app.ts'),
    ).toEqual([])
    expect(named('packages/db/src/repositories')).toEqual([])
    expect(named('apps/web/src/features/integrations').filter((f) => f !== 'logos.tsx')).toEqual([])
  })
})

describe('UI imports', () => {
  it('keeps the web app on @circi/ui: no MUI, emotion or lucide-react in apps/web/src', () => {
    expect(importsOf('apps/web/src', [MUI, EMOTION, 'lucide-react'])).toEqual([])
  })

  it('keeps MUI out of packages/ui/src', () => {
    expect(importsOf('packages/ui/src', [MUI])).toEqual([])
  })
})

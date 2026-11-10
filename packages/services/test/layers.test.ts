import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

import { describe, expect, it } from 'vitest'

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
 * Every rule is ENFORCED: no offender is allowed. The only escape is a NAMED EXCEPTION in
 * `EXCEPTIONS` below (rule id -> file -> why), for a file that breaks a rule on purpose; the
 * exceptions test fails when an entry no longer applies, so the list only holds live reasons.
 * `LAYERS_PRINT=1 pnpm vitest run packages/services/test/layers.test.ts` prints the current
 * offenders per rule (one JSON line).
 */

const root = join(import.meta.dirname, '../../..')

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

// The `@circi/db` root is the connection, the errors and the shared types; every persistence name
// comes from a subpath (`/queries`, `/repositories`, `/queue`, `/schema`), so a layer rule is a
// check on the specifier. The folder names under `packages/db/src` stand in for the subpaths
// when a file reaches into them by path.
const dbSubpath = (i: Resolved, names: string[]) =>
  new RegExp(`^@circi/db/(${names.join('|')})(/|$)`).test(i.spec) ||
  new RegExp(`^packages/db/src/(${names.join('|')})/`).test(i.file ?? '')
const reachesRepositories = (i: Resolved) =>
  dbSubpath(i, ['repositories', 'schema', 'queue', 'shared']) && !i.typeOnly
const reachesQueue = (i: Resolved) => dbSubpath(i, ['queue']) && !i.typeOnly

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
      dbSubpath(i, ['repositories', 'queue']) &&
      !i.typeOnly &&
      i.names.some((n) => MUTATING.test(n)),
  ) && !/\btx\b|withTransaction|\btransaction\(/.test(stripComments(file.text))

/** Rule ids are the numbers of docs/architecture-review/layering.md section 4.1. */
type RuleId =
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '9b'
  | '10'
  | '11'
  | '12'
  | '12b'
  | '13'
  | '14'
  | '15'

/** Files that break a rule on purpose, each with the reason. */
const EXCEPTIONS: Partial<Record<RuleId, Record<string, string>>> = {
  '7': {
    'packages/services/src/undo/record.ts':
      "`recordUndo` is called inside the transaction of the service whose change it records (its doc comment): it takes the caller's handle and opens none.",
    'packages/services/src/integration-admin/events.ts':
      "A building block called inside the transaction of the service that changed something (its doc comment): it takes the caller's handle and opens none.",
    'packages/services/src/pipeline/files.ts':
      'The pipeline is idempotent step by step: one transaction around long image processing would hold a database connection.',
    'packages/services/src/pipeline/process.ts':
      'The pipeline is idempotent step by step: one transaction around long image processing would hold a database connection.',
  },
}

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
        (i, file) =>
          circi(i) ||
          // `node/` is the Node-only entry (`@circi/core/node`); everything else is browser-safe,
          // so no `node:` module at all. `isIP` is a pure string check: the one thing the node
          // entry takes from node:net.
          (file.startsWith('packages/core/src/node/')
            ? /^node:(fs|net|http)/.test(i.spec) &&
              !(i.spec === 'node:net' && i.names.every((n) => n === 'isIP'))
            : i.spec.startsWith('node:')) ||
          ['drizzle-orm', 'pg'].some((p) => isPackage(i, p)),
      ),
  },
  {
    id: '2',
    title: 'storage, sites, diff and config import at most core',
    offenders: () =>
      offendersOf(
        ['storage', 'sites', 'diff', 'config'].map((p) => `packages/${p}/src`),
        notCore,
      ),
  },
  {
    id: '3',
    title: 'db imports none of services, integrations, storage, auth, api',
    offenders: () =>
      offendersOf(['packages/db/src'], (i) =>
        ['services', 'integrations', 'storage', 'auth', 'api'].some((p) => i.pkg === `@circi/${p}`),
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
    id: '5',
    title: 'db repositories do not import the queue (jobs, webhooks, git outbox): services queue',
    offenders: () =>
      offendersOf(['packages/db/src/repositories'], (i) =>
        (i.file ?? '').startsWith('packages/db/src/queue/'),
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
    title: 'the worker imports no repository (it claims jobs through services)',
    offenders: () => offendersOf(['apps/worker/src'], reachesRepositories),
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
    title:
      'integrations (SDK, clients and definitions) import at most core and api, and no fastify',
    offenders: () =>
      offendersOf(
        ['packages/integrations/src'],
        (i) =>
          (circi(i) && i.pkg !== '@circi/core' && i.pkg !== '@circi/api') ||
          isPackage(i, 'fastify'),
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
            !f.startsWith('packages/db/src/testing/') &&
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

if (process.env.LAYERS_PRINT) {
  console.log(
    `LAYERS_JSON${JSON.stringify(Object.fromEntries(RULES.map((r) => [r.id, r.offenders()])))}`,
  )
}

describe('layers: dependency rules (docs/architecture-review/layering.md section 4.1)', () => {
  for (const rule of RULES) {
    const excused = Object.keys(EXCEPTIONS[rule.id] ?? {})
    it(`rule ${rule.id}: ${rule.title}`, () => {
      const found = rule.offenders()
      expect(found.filter((f) => !excused.includes(f))).toEqual([])
      // An exception that no longer applies is deleted, so every entry stays a live reason.
      expect(excused.filter((f) => !found.includes(f))).toEqual([])
    })
  }
})

const named = (dir: string) =>
  readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' }).filter((f) =>
    /(github|gitlab|bitbucket|slack|linear|jira|figma)/i.test(f),
  )

describe('the integration SDK', () => {
  it('keeps @circi/integrations free of the database, services and apps', () => {
    expect(
      importsOf('packages/integrations/src', ['@circi/db', '@circi/services', '@circi/worker']),
    ).toEqual([])
  })

  it('keeps the database and core from importing the SDK', () => {
    expect(importsOf('packages/db/src', ['@circi/integrations'])).toEqual([])
    expect(importsOf('packages/core/src', ['@circi/integrations'])).toEqual([])
  })

  it('keeps the @circi/core root entry browser-safe and the web app on that root entry only', () => {
    // The root entry reaches every core source file except `node/` (and `node/` is not re-exported).
    const rootIndex = readFileSync(join(root, 'packages/core/src/index.ts'), 'utf8')
    expect(rootIndex).not.toMatch(/\/node\//)
    const core = scan('packages/core/src').filter(
      (f) => !f.file.startsWith('packages/core/src/node/'),
    )
    expect(
      core.filter((f) => f.imports.some((i) => i.spec.startsWith('node:'))).map((f) => f.file),
    ).toEqual([])
    const webCore = scan('apps/web/src').flatMap((f) =>
      f.imports.filter((i) => i.spec.startsWith('@circi/core/')).map(() => f.file),
    )
    expect(webCore).toEqual([])
    expect(
      core.filter((f) => f.imports.some((i) => i.file?.startsWith('packages/core/src/node/'))),
    ).toEqual([])
    expect(importsOf('apps/web/src', ['@circi/core/node'])).toEqual([])
  })

  it('keeps the web app from importing definitions (it reads their public data from the API)', () => {
    expect(importsOf('apps/web/src', ['@circi/integrations'])).toEqual([])
  })

  it('has no integration route, job or page named after one integration in the generic files', () => {
    const generic = [
      'apps/server/src/http/routes/dashboard/integrations/connect.ts',
      'apps/server/src/http/routes/dashboard/integrations/context.ts',
      'apps/server/src/http/routes/dashboard/integrations/links.ts',
      'apps/server/src/http/routes/dashboard/integrations/mapping.ts',
      'apps/server/src/http/routes/dashboard/integrations/oauth.ts',
      'apps/server/src/http/routes/dashboard/integrations/presenters.ts',
      'apps/server/src/http/routes/integration-webhook.ts',
      'packages/services/src/git/events.ts',
      'apps/web/src/features/integrations/GenericIntegrationPage.tsx',
    ]
    for (const file of generic) {
      expect(readFileSync(join(root, file), 'utf8')).not.toMatch(
        /slack|\bgithub\b|gitlab|bitbucket/i,
      )
    }
  })

  it('has no per-integration route, repository or page left: only definitions know a provider', () => {
    // `dashboard/instance/github-app.ts` is the instance's GitHub App setup (the manifest flow): the
    // instance-level app an integration may need (docs/integration-sdk.md, "Adding an
    // integration" step 4), not a route that connects or maps anything.
    expect(
      named('apps/server/src/http/routes').filter((f) => f !== 'dashboard/instance/github-app.ts'),
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

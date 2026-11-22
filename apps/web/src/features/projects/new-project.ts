/** The pure parts of the New project dialog: the address, the CI snippets, the notes and the warnings. */

export const DEFAULT_BRANCH = 'main'

/** The address a project gets from its name: lower case, anything but letters and digits becomes one dash. */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
  return slug || 'project'
}

/** The default branch is only sent when the person changed it: a new project starts on `main`. */
export const branchToSet = (branch: string): string | undefined => {
  const value = branch.trim()
  return value && value !== DEFAULT_BRANCH ? value : undefined
}

export type CiKey = 'github' | 'gitlab' | 'bitbucket' | 'jenkins' | 'other'

export interface CiContext {
  /** The project's CI token, shown once. */
  token: string
  /** `workspace/project`: which project the token belongs to. */
  project: string
  /** The address of this CirCI instance. */
  apiUrl: string
}

export interface CiExample {
  key: CiKey
  label: string
  snippet: (ctx: CiContext) => string
  note: (ctx: CiContext) => string
}

/**
 * The CI examples of https://circi.dev/ci/ci-examples/, one per CI system. The token itself is only written
 * where it can't live in a secret store (a shell session, "Other"); the others read it from the
 * secret named `CIRCI_TOKEN`.
 */
export const CI_EXAMPLES: readonly CiExample[] = [
  {
    key: 'github',
    label: 'GitHub Actions',
    snippet: ({ project, apiUrl }) =>
      [
        `# CirCI project: ${project}`,
        '- uses: actions/checkout@v4',
        '  with: { fetch-depth: 0 }',
        '- run: npx playwright test            # writes screenshots to ./screenshots',
        '- run: npx circi upload ./screenshots --wait',
        '  env:',
        '    CIRCI_TOKEN: ${{ secrets.CIRCI_TOKEN }}',
        `    CIRCI_API_URL: ${apiUrl}`,
      ].join('\n'),
    note: () =>
      "Save the token as a repository secret named CIRCI_TOKEN. fetch-depth: 0 isn't needed: the CLI fetches the history it needs (a full fetch is only faster on large repositories).",
  },
  {
    key: 'gitlab',
    label: 'GitLab CI',
    snippet: ({ project, apiUrl }) =>
      [
        `# CirCI project: ${project} (CIRCI_API_URL=${apiUrl})`,
        'visual:',
        '  script:',
        '    - npx playwright test',
        '    - npx circi upload ./screenshots --wait',
        '  variables:',
        '    GIT_DEPTH: 0',
      ].join('\n'),
    note: ({ apiUrl }) =>
      `Set CIRCI_TOKEN (masked) and CIRCI_API_URL=${apiUrl} under Settings › CI/CD › Variables.`,
  },
  {
    key: 'bitbucket',
    label: 'Bitbucket Pipelines',
    snippet: ({ project, apiUrl }) =>
      [
        `# CirCI project: ${project} (CIRCI_API_URL=${apiUrl})`,
        '- step:',
        '    script:',
        '      - npx playwright test',
        '      - npx circi upload ./screenshots --wait',
      ].join('\n'),
    note: ({ apiUrl }) =>
      `Add CIRCI_TOKEN (secured) and CIRCI_API_URL=${apiUrl} under Repository settings › Pipelines › Variables.`,
  },
  {
    key: 'jenkins',
    label: 'Jenkins',
    snippet: ({ project, apiUrl }) =>
      [
        `// CirCI project: ${project}`,
        "sh 'npx playwright test'",
        "withCredentials([string(credentialsId: 'circi-token', variable: 'CIRCI_TOKEN')]) {",
        `  sh 'CIRCI_API_URL=${apiUrl} npx circi upload ./screenshots --wait'`,
        '}',
      ].join('\n'),
    note: () =>
      'Store the token as a secret text credential named circi-token. For pull requests also set CIRCI_PR_NUMBER, CIRCI_BRANCH and CIRCI_BASE_BRANCH (CHANGE_ID, BRANCH_NAME, CHANGE_TARGET in multibranch jobs).',
  },
  {
    key: 'other',
    label: 'Other',
    snippet: ({ project, token, apiUrl }) =>
      [
        `# CirCI project: ${project}`,
        `export CIRCI_TOKEN=${token}`,
        `export CIRCI_API_URL=${apiUrl}`,
        'npx circi upload ./screenshots --wait',
      ].join('\n'),
    note: () =>
      'The CLI reads commit, branch and pull request from CircleCI, Buildkite, Azure Pipelines and Gitea or Forgejo Actions too. Anywhere else, set CIRCI_COMMIT, CIRCI_BRANCH, CIRCI_PR_NUMBER and CIRCI_BASE_BRANCH.',
  },
]

/** What `--wait` does for this project: the merge gate is the pull request's check, or the CI job. */
export const gateNote = (linked: boolean): string =>
  linked
    ? 'With a linked repository, --wait exits 0 once processing finishes; the check on the pull request is the merge gate.'
    : '--wait exits 1 while changes need review, so the CI job is the merge gate.'

/** What the Repository field's help says. */
export const repoHelp = (linked: boolean): string =>
  linked
    ? 'CirCI posts a check on each pull request, and approving turns it green with no CI re-run.'
    : 'Without one, --wait fails the CI job until changes are approved.'

/** A repository a new project can be linked to: a target of one of the workspace's git integrations. */
export interface RepoChoice {
  /** `integration id` and `repository id`, as one select value. */
  value: string
  integration: string
  ref: string
  name: string
}

export const NO_REPOSITORY = ''

export function repoChoices(
  integrations: ReadonlyArray<{
    id: string
    targets: ReadonlyArray<{ id: string; name: string; label?: string }>
  }>,
): RepoChoice[] {
  return integrations.flatMap((integration) =>
    integration.targets.map((target) => ({
      value: `${integration.id}\u001f${target.id}`,
      integration: integration.id,
      ref: target.id,
      name: target.label ?? target.name,
    })),
  )
}

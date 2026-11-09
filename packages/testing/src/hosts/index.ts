/**
 * Fakes of the external services' HTTP edges (GitHub, GitLab, Bitbucket, Slack, Linear, Jira,
 * Figma, an OpenID provider). They hold no database, so every package, and e2e, imports them as
 * `@circi/testing/hosts`.
 */
export * from './bitbucket.ts'
export * from './figma.ts'
export * from './github.ts'
export * from './gitlab.ts'
export * from './gitlab-server.ts'
export * from './idp.ts'
export * from './slack.ts'
export * from './trackers.ts'
export * from './types.ts'

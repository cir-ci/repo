import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

const integrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings/integrations',
  component: lazyRouteComponent(() => import('./IntegrationsPage.tsx'), 'IntegrationsPage'),
})

const githubRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings/integrations/github',
  component: lazyRouteComponent(
    () => import('./GithubIntegrationPage.tsx'),
    'GithubIntegrationPage',
  ),
})

const bitbucketRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings/integrations/bitbucket',
  component: lazyRouteComponent(
    () => import('./BitbucketIntegrationPage.tsx'),
    'BitbucketIntegrationPage',
  ),
})

const linearRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings/integrations/linear',
  component: lazyRouteComponent(
    () => import('./TrackerIntegrationPage.tsx'),
    'LinearIntegrationPage',
  ),
})

const jiraRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings/integrations/jira',
  component: lazyRouteComponent(
    () => import('./TrackerIntegrationPage.tsx'),
    'JiraIntegrationPage',
  ),
})

const gitlabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings/integrations/gitlab',
  component: lazyRouteComponent(
    () => import('./GitlabIntegrationPage.tsx'),
    'GitlabIntegrationPage',
  ),
})

const slackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings/integrations/slack',
  component: lazyRouteComponent(() => import('./SlackIntegrationPage.tsx'), 'SlackIntegrationPage'),
})

const figmaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings/integrations/figma',
  component: lazyRouteComponent(() => import('./FigmaIntegrationPage.tsx'), 'FigmaIntegrationPage'),
})

export const integrationsRoutes = [
  figmaRoute,
  integrationsRoute,
  githubRoute,
  bitbucketRoute,
  slackRoute,
  linearRoute,
  jiraRoute,
  gitlabRoute,
]

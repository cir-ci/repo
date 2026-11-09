/**
 * The files that break a layer rule today (see the top of layers.test.ts for how the ratchet
 * works). Rule ids are the numbers of docs/architecture-review/layering.md section 4.1.
 * Entries are only ever DELETED, by the step that fixes the file.
 */
export type RuleId =
  | '1'
  | '2'
  | '3'
  | '4'
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

export const RATCHET: Partial<Record<RuleId, string[]>> = {
  '4': [
    'packages/db/src/queries/activity.ts',
    'packages/db/src/queries/builds.ts',
    'packages/db/src/queries/figma.ts',
    'packages/db/src/queries/files.ts',
    'packages/db/src/queries/inbox.ts',
    'packages/db/src/queries/insights.ts',
    'packages/db/src/queries/integrations.ts',
    'packages/db/src/queries/reviews.ts',
    'packages/db/src/queries/search.ts',
    'packages/db/src/queries/sidebar.ts',
    'packages/db/src/queries/storage.ts',
    'packages/db/src/queries/teams.ts',
    'packages/db/src/queries/triage.ts',
    'packages/db/src/queries/workspace-builds.ts',
  ],
  '7': [
    'packages/services/src/integration-events.ts',
    'packages/services/src/issues.ts',
    'packages/services/src/notifications.ts',
    'packages/services/src/retention.ts',
    'packages/services/src/workspaces.ts',
  ],
  '8': [
    'apps/server/src/cli/admin.ts',
    'apps/server/src/http/hooks/instance-admin.ts',
    'apps/server/src/http/hooks/session.ts',
    'apps/server/src/http/lib/github-app.ts',
    'apps/server/src/http/lib/instance-settings.ts',
    'apps/server/src/http/lib/team-access.ts',
    'apps/server/src/http/lib/workspace-access.ts',
    'apps/server/src/http/routes/argos/index.ts',
    'apps/server/src/http/routes/dashboard/activity.ts',
    'apps/server/src/http/routes/dashboard/baselines.ts',
    'apps/server/src/http/routes/dashboard/comments.ts',
    'apps/server/src/http/routes/dashboard/domains.ts',
    'apps/server/src/http/routes/dashboard/files.ts',
    'apps/server/src/http/routes/dashboard/github-app.ts',
    'apps/server/src/http/routes/dashboard/ignore-regions.ts',
    'apps/server/src/http/routes/dashboard/inbox.ts',
    'apps/server/src/http/routes/dashboard/instance-health.ts',
    'apps/server/src/http/routes/dashboard/instance.ts',
    'apps/server/src/http/routes/dashboard/integrations-generic.ts',
    'apps/server/src/http/routes/dashboard/integrations.ts',
    'apps/server/src/http/routes/dashboard/issue-trackers.ts',
    'apps/server/src/http/routes/dashboard/reviews.ts',
    'apps/server/src/http/routes/dashboard/rules.ts',
    'apps/server/src/http/routes/dashboard/settings.ts',
    'apps/server/src/http/routes/dashboard/setup.ts',
    'apps/server/src/http/routes/dashboard/site-handoff.ts',
    'apps/server/src/http/routes/dashboard/team-sites.ts',
    'apps/server/src/http/routes/dashboard/teams.ts',
    'apps/server/src/http/routes/dashboard/triage.ts',
    'apps/server/src/http/routes/dashboard/views.ts',
    'apps/server/src/http/routes/dashboard/workspace-auth.ts',
    'apps/server/src/http/routes/dashboard/workspace-settings.ts',
    'apps/server/src/http/routes/dashboard/workspace-sso.ts',
    'apps/server/src/http/routes/dashboard/workspaces.ts',
    'apps/server/src/http/routes/integration-webhook.ts',
    'apps/server/src/http/routes/v1/builds.ts',
    'apps/server/src/http/routes/v1/files.ts',
    'apps/server/src/http/routes/v1/sites.ts',
    'apps/server/src/http/sites/serve.ts',
    'apps/worker/src/jobs/deliver-webhook.ts',
    'apps/worker/src/jobs/integration-event.ts',
    'apps/worker/src/jobs/notify-git.ts',
    'apps/worker/src/jobs/process-build.ts',
    'apps/worker/src/jobs/send-email.ts',
    'apps/worker/src/lib/files.ts',
    'apps/worker/src/runner.ts',
  ],
  '9b': [
    'apps/server/src/http/routes/dashboard/instance-health.ts',
    'apps/server/src/http/routes/dashboard/settings.ts',
    'apps/server/src/http/routes/dashboard/teams.ts',
    'apps/server/src/http/routes/integration-webhook.ts',
    'apps/server/src/http/routes/v1/builds.ts',
  ],
  '10': [
    'apps/worker/src/jobs/deliver-webhook.ts',
    'apps/worker/src/jobs/integration-event.ts',
    'apps/worker/src/jobs/notify-git.ts',
    'apps/worker/src/jobs/process-build.ts',
    'apps/worker/src/jobs/send-email.ts',
    'apps/worker/src/lib/files.ts',
  ],
  '12b': ['packages/integrations/src/errors.ts'],
  '13': ['apps/server/src/lifecycle/services.ts', 'packages/db/src/client.ts'],
  '14': [
    'apps/server/src/http/routes/dashboard/comments.ts',
    'apps/server/src/http/routes/dashboard/domains.ts',
    'apps/server/src/http/routes/dashboard/github-app.ts',
    'apps/server/src/http/routes/dashboard/instance-accounts.ts',
    'apps/server/src/http/routes/dashboard/integrations-generic.ts',
    'apps/server/src/http/routes/dashboard/integrations.ts',
    'apps/server/src/http/routes/dashboard/rules.ts',
    'apps/server/src/http/routes/dashboard/settings.ts',
    'apps/server/src/http/routes/dashboard/workspace-auth.ts',
    'apps/server/src/http/routes/dashboard/workspace-settings.ts',
    'apps/server/src/http/routes/dashboard/workspace-sso.ts',
    'apps/server/src/http/routes/dashboard/workspaces.ts',
  ],
  '15': [
    'apps/server/src/http/routes/argos/index.ts',
    'apps/server/src/http/routes/dashboard/integrations-generic.ts',
    'apps/server/src/http/routes/dashboard/reviews.ts',
    'apps/server/src/http/routes/dashboard/settings.ts',
  ],
}

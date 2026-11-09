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

export const RATCHET: Partial<Record<RuleId, string[]>> = {
  '7': [
    'packages/services/src/integration-events.ts',
    'packages/services/src/notifications.ts',
    // The pipeline is idempotent step by step on purpose: one transaction around image work would hold it open.
    'packages/services/src/pipeline/files.ts',
    'packages/services/src/pipeline/process.ts',
  ],
  '8': ['apps/worker/src/runner.ts'],
  '9b': [],
  '10': [],
  '12b': [],
  '13': ['apps/server/src/lifecycle/services.ts', 'packages/db/src/client.ts'],
  '14': [],
  '15': [
    'apps/server/src/http/routes/dashboard/integrations-generic.ts',
    'apps/server/src/http/routes/dashboard/reviews.ts',
    'apps/server/src/http/routes/dashboard/settings.ts',
  ],
}

import { resolve } from 'node:path'

import e2e from '@circi/vitest-config/vitest.e2e.config.ts'

import { E2eTimingReporter } from './src/reporting/timing-reporter.ts'

export default e2e(import.meta.dirname, {
  globalSetup: resolve(import.meta.dirname, 'src/stack/global-setup.ts'),
  timingReporter: new E2eTimingReporter(),
})

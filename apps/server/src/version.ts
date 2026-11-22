import pkg from '../package.json' with { type: 'json' }

/**
 * The app's version: `@circi/server`'s, which Changesets bumps for every release of the image
 * (`ghcr.io/cir-ci/circi:<version>`). The bundle inlines it, so the running server reports the
 * version it was built as (`circi --version`, `/healthz`).
 */
export const VERSION: string = pkg.version

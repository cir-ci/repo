# Changesets

Five things are released: `@circi/cli`, `@circi/vitest`, `@circi/storybook` and `@circi/cypress` (published to npm)
and the app, whose version is `@circi/server`'s (each release publishes `ghcr.io/cir-ci/circi:<version>`). A change to
any of them needs a changeset: the post-commit hook writes one from the commit message, or run `pnpm changeset` for a
better release note. Merging the "Version Packages" pull request releases them, and once a release is out the workflow asks
[cir-ci/documentation](https://github.com/cir-ci/documentation) to rebuild circi.dev, whose changelog is built from
these packages' `CHANGELOG.md` files (the `docs` job in `.github/workflows/release.yml`). Every other package
(`apps/*`, `packages/*`, `e2e`, `dev`, `perf`) is versioned too, privately: a change to one needs a changeset with a
written note as well, never an empty one. The full guide: https://circi.dev/contributing/how-to-contribute/#changesets

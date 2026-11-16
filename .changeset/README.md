# Changesets

Only `@circi/cli` and `@circi/vitest` are published to npm; every other package is private and has no version.
A change to either needs a changeset: run `pnpm changeset`, pick the package(s) and the bump, and write one line for the changelog.
Commit the generated file with your change. When pull requests with changesets reach `main`, the release workflow opens a
"Version Packages" pull request; merging it publishes. See the contributing guide: https://circi.dev/contributing/how-to-contribute/

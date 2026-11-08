# Migrating from Argos

CirCI speaks the upload protocol of the Argos SDKs under `/v2`, so a project that uploads with `@argos-ci/playwright`, `@argos-ci/cypress`, `@argos-ci/storybook` or `@argos-ci/cli` can switch by changing two values:

```sh
ARGOS_API_BASE_URL=https://ci.acme.io/v2
ARGOS_TOKEN=circi_…          # a CirCI project token
```

`circi argos-env` prints exactly these two lines from `CIRCI_API_URL` and `CIRCI_TOKEN`.

> **Status:** built from the SDK's source (`@argos-ci/core` `upload()`) and tested with a client that plays the same requests. It has **not** been run with the real SDKs yet. If an SDK refuses the token's format or sends something unexpected, the error is in the SDK's output and the CirCI server log: please report it.

## What works

- Project lookup, baseline lookup from commit history the SDK collected, build creation, the file upload target, updates in chunks, parallel builds (`parallel`/`parallelNonce`/`parallelIndex`/`parallelTotal`), build names.
- History from the SDK is used to find the baseline (`baseline_source: sdk` on the build page).
- Pull request number, branch and reference branch/commit.

## What doesn't

- **PNG only.** CirCI compares PNG screenshots; an SDK sending JPEG is refused.
- **Traces, per-screenshot thresholds, `parentName`/`baseName`, merge queue fields** are accepted and ignored.
- **Manually finalized parallel builds** (`parallelTotal: -1`) are refused: pass the real total.
- No Argos GitHub bot behaviour comes with the SDK: link the repository to CirCI's own GitHub App instead (see the README).

## Moving the history

Existing Argos builds aren't imported. The first build on your default branch after switching becomes the baseline once someone approves it (a first build is never approved automatically); after that, auto-approve on the default branch (on by default) keeps the baseline moving without review.

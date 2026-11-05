# CI examples

Every example uploads a directory of PNG screenshots with `circi upload`. Put the project's token in your CI's secret store as `CIRCI_TOKEN` and your CirCI address in `CIRCI_API_URL`.

The CLI reads the commit, branch and pull request from the CI's environment. It needs enough git history to find the right baseline: it fetches the base branch and a little more itself, so shallow checkouts work, but a full fetch is faster for large repositories.

## GitHub Actions

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- run: npx playwright test            # writes screenshots to ./screenshots
- run: npx circi upload ./screenshots --wait
  env:
    CIRCI_TOKEN: ${{ secrets.CIRCI_TOKEN }}
    CIRCI_API_URL: https://ci.acme.io
```

With the GitHub App linked to the repository, `--wait` exits 0 even when changes need review and the **CirCI** check is the merge gate (mark it required). Without it, the job fails until the changes are approved, then re-run it.

### Sharded runs

```yaml
strategy:
  matrix: { shard: [1, 2, 3, 4] }
steps:
  - run: npx playwright test --shard=${{ matrix.shard }}/4
  - run: npx circi upload ./screenshots --shard ${{ matrix.shard }}/4 --wait
```

Every job uploads its own screenshots; CirCI joins them into one build (they share the run's id) and processes it when the fourth arrives. A shard that never arrives fails the build after `UPLOAD_TIMEOUT_MINUTES` (default 60), naming the missing shards. A re-run of the workflow is a new attempt and starts a new build.

### Several builds per commit

`--name chromium` and `--name mobile` give each kind of build its own baselines:

```yaml
- run: npx circi upload ./screenshots-chromium --name chromium
- run: npx circi upload ./screenshots-mobile --name mobile
```

## GitLab CI

```yaml
visual:
  script:
    - npx playwright test
    - npx circi upload ./screenshots --wait
  variables:
    GIT_DEPTH: 0
```
Set `CIRCI_TOKEN` and `CIRCI_API_URL` under Settings → CI/CD → Variables. For a sharded job use `parallel: 4` and `--shard $CI_NODE_INDEX/$CI_NODE_TOTAL`.

## Bitbucket Pipelines

```yaml
- step:
    script:
      - npx playwright test
      - npx circi upload ./screenshots --wait
```
Add the variables under Repository settings → Pipelines → Variables.

## Gitea / Forgejo Actions

The GitHub Actions example works as is: the environment looks the same.

## Jenkins

```groovy
sh 'npx playwright test'
withCredentials([string(credentialsId: 'circi-token', variable: 'CIRCI_TOKEN')]) {
  sh 'CIRCI_API_URL=https://ci.acme.io npx circi upload ./screenshots --wait'
}
```
Jenkins doesn't say which pull request a build is for unless you pass it: set `CIRCI_PR_NUMBER`, `CIRCI_BRANCH` and `CIRCI_BASE_BRANCH` (the multibranch plugin provides `CHANGE_ID`, `BRANCH_NAME` and `CHANGE_TARGET`).

## Overrides

`CIRCI_COMMIT`, `CIRCI_BRANCH`, `CIRCI_PR_NUMBER`, `CIRCI_BASE_BRANCH` replace what's detected. `CIRCI_PARALLEL_NONCE` ties shards together when the CI isn't recognised.

## Exit codes

`0` pass, `1` visual changes block the merge (with `--wait`), `2` error.

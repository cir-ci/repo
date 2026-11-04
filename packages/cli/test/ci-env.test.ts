import { describe, expect, it } from 'vitest'

import { detectCi } from '../src/ci-env.ts'

const noFile = () => {
  throw new Error('no event file')
}

describe('detectCi', () => {
  it('GitHub pull_request: uses the PR head SHA, not the merge commit', () => {
    const event = {
      pull_request: {
        number: 42,
        head: { sha: 'feedface1', ref: 'feature/login', repo: { full_name: 'alice/app' } },
        base: { ref: 'main', repo: { full_name: 'acme/app' } },
      },
    }
    const ctx = detectCi(
      {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: '/event.json',
        GITHUB_SHA: 'merge0000',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'acme/app',
        GITHUB_RUN_ID: '99',
      },
      (p) => (p === '/event.json' ? event : noFile()),
    )
    expect(ctx).toEqual({
      provider: 'github',
      commitSha: 'feedface1',
      branch: 'feature/login',
      prNumber: 42,
      baseBranch: 'main',
      fromFork: true,
      jobUrl: 'https://github.com/acme/app/actions/runs/99',
    })
  })

  it('GitHub push to a branch', () => {
    expect(
      detectCi(
        {
          GITHUB_ACTIONS: 'true',
          GITHUB_EVENT_NAME: 'push',
          GITHUB_SHA: 'abc1234',
          GITHUB_REF_TYPE: 'branch',
          GITHUB_REF_NAME: 'main',
        },
        noFile,
      ),
    ).toEqual({ provider: 'github', commitSha: 'abc1234', branch: 'main' })
  })

  it('GitHub tag push has no branch', () => {
    expect(
      detectCi(
        {
          GITHUB_ACTIONS: 'true',
          GITHUB_SHA: 'abc1234',
          GITHUB_REF_TYPE: 'tag',
          GITHUB_REF_NAME: 'v1.0',
        },
        noFile,
      ),
    ).toEqual({ provider: 'github', commitSha: 'abc1234' })
  })

  it('Gitea/Forgejo Actions reuse GitHub variables', () => {
    expect(
      detectCi(
        {
          GITHUB_ACTIONS: 'true',
          GITEA_ACTIONS: 'true',
          GITHUB_SHA: 'abc1234',
          GITHUB_REF_TYPE: 'branch',
          GITHUB_REF_NAME: 'dev',
        },
        noFile,
      ),
    ).toMatchObject({ provider: 'gitea', branch: 'dev' })
  })

  it('GitLab merge request pipeline from a fork', () => {
    expect(
      detectCi(
        {
          GITLAB_CI: 'true',
          CI_COMMIT_SHA: 'merged000',
          CI_MERGE_REQUEST_IID: '7',
          CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: 'source111',
          CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'fix',
          CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main',
          CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '2',
          CI_MERGE_REQUEST_PROJECT_ID: '1',
          CI_JOB_URL: 'https://gitlab.example/job/5',
        },
        noFile,
      ),
    ).toEqual({
      provider: 'gitlab',
      commitSha: 'source111',
      branch: 'fix',
      prNumber: 7,
      baseBranch: 'main',
      fromFork: true,
      jobUrl: 'https://gitlab.example/job/5',
    })
  })

  it('GitLab MR pipeline without merged results falls back to CI_COMMIT_SHA', () => {
    expect(
      detectCi(
        {
          GITLAB_CI: 'true',
          CI_COMMIT_SHA: 'abc1234',
          CI_MERGE_REQUEST_IID: '3',
          CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: '',
        },
        noFile,
      ),
    ).toMatchObject({ commitSha: 'abc1234', prNumber: 3 })
  })

  it('GitLab branch pipeline', () => {
    expect(
      detectCi({ GITLAB_CI: 'true', CI_COMMIT_SHA: 'abc1234', CI_COMMIT_BRANCH: 'main' }, noFile),
    ).toEqual({
      provider: 'gitlab',
      commitSha: 'abc1234',
      branch: 'main',
    })
  })

  it('Bitbucket pull request', () => {
    expect(
      detectCi(
        {
          BITBUCKET_BUILD_NUMBER: '12',
          BITBUCKET_COMMIT: 'abc1234',
          BITBUCKET_BRANCH: 'fix',
          BITBUCKET_PR_ID: '5',
          BITBUCKET_PR_DESTINATION_BRANCH: 'main',
        },
        noFile,
      ),
    ).toEqual({
      provider: 'bitbucket',
      commitSha: 'abc1234',
      branch: 'fix',
      prNumber: 5,
      baseBranch: 'main',
    })
  })

  it('CircleCI reads the PR number from the PR URL', () => {
    expect(
      detectCi(
        {
          CIRCLECI: 'true',
          CIRCLE_SHA1: 'abc1234',
          CIRCLE_BRANCH: 'fix',
          CIRCLE_PULL_REQUEST: 'https://github.com/acme/app/pull/31',
        },
        noFile,
      ),
    ).toMatchObject({ provider: 'circleci', prNumber: 31 })
  })

  it('Buildkite treats "false" as no PR', () => {
    expect(
      detectCi(
        {
          BUILDKITE: 'true',
          BUILDKITE_COMMIT: 'abc1234',
          BUILDKITE_BRANCH: 'main',
          BUILDKITE_PULL_REQUEST: 'false',
        },
        noFile,
      ),
    ).toEqual({ provider: 'buildkite', commitSha: 'abc1234', branch: 'main' })
  })

  it('Jenkins multibranch PR uses CHANGE_BRANCH, not "PR-12"', () => {
    expect(
      detectCi(
        {
          JENKINS_URL: 'https://ci',
          GIT_COMMIT: 'abc1234',
          BRANCH_NAME: 'PR-12',
          CHANGE_ID: '12',
          CHANGE_BRANCH: 'fix',
          CHANGE_TARGET: 'main',
        },
        noFile,
      ),
    ).toMatchObject({ provider: 'jenkins', branch: 'fix', prNumber: 12, baseBranch: 'main' })
  })

  it('Jenkins strips origin/ from GIT_BRANCH', () => {
    expect(
      detectCi(
        { JENKINS_URL: 'https://ci', GIT_COMMIT: 'abc1234', GIT_BRANCH: 'origin/main' },
        noFile,
      ),
    ).toMatchObject({
      branch: 'main',
    })
  })

  it('Azure Pipelines pull request', () => {
    expect(
      detectCi(
        {
          TF_BUILD: 'True',
          BUILD_SOURCEVERSION: 'merge0000',
          SYSTEM_PULLREQUEST_PULLREQUESTNUMBER: '9',
          SYSTEM_PULLREQUEST_SOURCECOMMITID: 'abc1234',
          SYSTEM_PULLREQUEST_SOURCEBRANCH: 'refs/heads/fix',
          SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main',
          SYSTEM_PULLREQUEST_ISFORK: 'False',
        },
        noFile,
      ),
    ).toMatchObject({
      provider: 'azure',
      commitSha: 'abc1234',
      branch: 'fix',
      baseBranch: 'main',
      prNumber: 9,
      fromFork: false,
    })
  })

  it('CIRCI_* overrides win, for unknown CIs', () => {
    expect(
      detectCi(
        {
          GITLAB_CI: 'true',
          CI_COMMIT_SHA: 'abc1234',
          CI_COMMIT_BRANCH: 'main',
          CIRCI_BRANCH: 'release',
          CIRCI_PR_NUMBER: '4',
          CIRCI_BASE_BRANCH: 'main',
        },
        noFile,
      ),
    ).toMatchObject({ commitSha: 'abc1234', branch: 'release', prNumber: 4, baseBranch: 'main' })
    expect(detectCi({ CIRCI_COMMIT: 'abc1234', CIRCI_BRANCH: 'x' }, noFile)).toEqual({
      provider: 'local',
      commitSha: 'abc1234',
      branch: 'x',
    })
  })
})

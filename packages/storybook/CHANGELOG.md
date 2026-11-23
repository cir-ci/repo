# @circi/storybook

## 0.1.0

### Minor Changes

- [#35](https://github.com/cir-ci/repo/pull/35) [`ab6be07`](https://github.com/cir-ci/repo/commit/ab6be076a8559f5167443de59bd7d3df5140e28b) Thanks [@michaelhazan](https://github.com/michaelhazan)! - First release. `@circi/storybook` screenshots every story of a built Storybook with Playwright and uploads them to CirCI. List the addon in `.storybook/main.ts` (`addons: [circi({ … })]`) for its options, then run `circi-storybook upload` in CI. Screenshots are cropped to the rendered component (fullscreen stories are captured whole), named by story title and name, and carry the story ID, browser and viewport as metadata. Per-story settings are `parameters.circi` (`skip`, `viewports`, `delay`, `selector`, `padding`); stories that fail are reported and nothing is uploaded from a run with failures.

### Patch Changes

- [#35](https://github.com/cir-ci/repo/pull/35) [`ab6be07`](https://github.com/cir-ci/repo/commit/ab6be076a8559f5167443de59bd7d3df5140e28b) Thanks [@michaelhazan](https://github.com/michaelhazan)! - A shard with no stories (more shards than stories, or every story skipped) now reports in empty, so the parallel build completes. The summary counts a story that skips itself once, however many browsers run. The release script now builds this package before publishing.

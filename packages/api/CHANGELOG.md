# @circi/api

## 0.1.0

### Minor Changes

- [#44](https://github.com/cir-ci/repo/pull/44) [`365fbaa`](https://github.com/cir-ci/repo/commit/365fbaa8e5857dc73cc2723504c0627377f7aa07) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Removed the Argos-compatible `/v2` API, which never worked with the real Argos SDKs (they reject CirCI's token format and localhost, and expect a different baseline reply). Upload with `circi upload`, the Vitest plugin or the Cypress plugin. A migration drops the unused `commit_ancestry` table (`builds.history_source` stays for one more release so a rolling deploy is safe), and builds that recorded `sdk` as their baseline source now show none. The Projects empty state no longer mentions Argos.

# @circi/core

## 0.0.1

### Patch Changes

- [#40](https://github.com/cir-ci/repo/pull/40) [`a485d66`](https://github.com/cir-ci/repo/commit/a485d6669f5bd06c50305b180aee282952f45d91) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Push notifications no longer stop for everyone now and then. About 1 in 256 of the server's web push keys was read back as invalid, so the server made new keys and dropped every device's subscription, and people had to turn push on again. Keys made before this release keep working.

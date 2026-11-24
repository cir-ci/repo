---
'@circi/cli': patch
'@circi/vitest': patch
'@circi/cypress': patch
'@circi/storybook': patch
---

The CLI and the Vitest, Cypress and Storybook plugins are now under the MIT License instead of GPL-3.0-only, so they can be added to any project's dependencies without a license review. The CirCI server stays GPL-3.0-only.

`@circi/cypress` now depends on `tar` instead of bundling a copy of it, like the other packages, so `tar`'s own license (Blue Oak Model License 1.0.0) comes with it and the package is smaller.

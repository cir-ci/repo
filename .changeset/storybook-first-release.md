---
'@circi/storybook': minor
---

First release. `@circi/storybook` screenshots every story of a built Storybook with Playwright and uploads them to CirCI. List the addon in `.storybook/main.ts` (`addons: [circi({ … })]`) for its options, then run `circi-storybook upload` in CI. Screenshots are cropped to the rendered component (fullscreen stories are captured whole), named by story title and name, and carry the story ID, browser and viewport as metadata. Per-story settings are `parameters.circi` (`skip`, `viewports`, `delay`, `selector`, `padding`); stories that fail are reported and nothing is uploaded from a run with failures.

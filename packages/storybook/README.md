# @circi/storybook

The [CirCI](https://circi.dev) addon for Storybook. It screenshots every story of a built Storybook with Playwright and uploads the PNGs to your CirCI server, where they are compared and reviewed. Each story's name in CirCI is its title and story name: `Components/Button` and `Primary` become `components/button/primary`.

```sh
npm install --save-dev @circi/storybook playwright
npx playwright install chromium
```

List the addon in `.storybook/main.ts`, where its options live:

```ts
import { circiStorybook } from '@circi/storybook'

export default {
  addons: [circiStorybook({ name: 'storybook', browsers: ['chromium'], viewports: ['1280x720'] })],
}
```

Then, in CI, with `CIRCI_API_URL` and `CIRCI_TOKEN` set:

```sh
npx storybook build
npx circi-storybook upload --wait
```

Or let it build first with `--build`. Without the token, or without `CIRCI_API_URL`, the screenshots are written to `.circi/screenshots/storybook` and nothing is uploaded, as with `@circi/vitest`.

## What a screenshot is

Only the rendered component, never the empty canvas around it:

- By default the screenshot is cropped to the story's content: everything visible inside Storybook's root, with its box shadows, plus what the story renders into the page body outside the root (tooltips, menus and dialogs in portals). The `centered` and `padded` layouts add no whitespace.
- A story with `layout: 'fullscreen'` is page-like: the whole page, at the viewport's width and the content's full height.
- `parameters.circi.selector` captures one element instead, and `padding` adds pixels around the crop.
- A story that renders nothing (an empty or invisible root) is an error, not a blank image.

Before the screenshot the page has to be still: Storybook has reported the story rendered and its `play` function finished, fonts and images are loaded, the network is idle, and animations, transitions and the caret are off. A story that throws, or whose `play` function throws, fails and is reported with its message.

## Options

All of them are optional. In `circiStorybook({ … })` they are `circiStorybook.Options`; `circi-storybook upload` takes them as flags, which override the config.

| Option                                                                  | Flag                                          | Meaning                                                                                                                                  |
| ----------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `apiUrl`, `token`                                                       | `--api-url`, `CIRCI_TOKEN`                    | CirCI address and project CI token. Default `CIRCI_API_URL` and `CIRCI_TOKEN`. Keep the token in the environment.                         |
| `name`                                                                  | `--name`                                      | Build name. Default `storybook`.                                                                                                         |
| `dir`                                                                   | `--dir`                                       | Where captures are written, under `root`. Default `.circi/screenshots`; they go to its `storybook` folder, apart from `@circi/vitest`'s. |
| `clean`                                                                 | `--clean`                                     | Empty that folder first.                                                                                                                 |
| `root`                                                                  | `--root`                                      | Project root. Default: the working directory.                                                                                            |
| `wait`                                                                  | `--wait`                                      | Wait for the result; exit 1 when changes need review.                                                                                    |
| `strict`                                                                | `--strict`                                    | Exit 2 if the upload fails.                                                                                                              |
| `shard`                                                                 | `--shard 2/4`, `--nonce`                      | Screenshot and upload every 4th story from the 2nd, as one shard of a parallel build.                                                    |
| `staticDir`, `build`                                                    | the `<dir>` argument, `--build`               | The built Storybook (default `storybook-static`), and whether to run `storybook build` into it first.                                    |
| `browsers`                                                              | `--browser`                                   | `chromium` (default), `firefox`, `webkit`.                                                                                               |
| `viewports`                                                             | `--viewport`                                  | `1280x720` (default) or `mobile=390x844`.                                                                                                |
| `concurrency`                                                           | `--concurrency`                               | Stories screenshotted at once. Default 4.                                                                                                |
| `include`, `exclude`                                                    | `--include`, `--exclude`                      | Globs over a story ID or `Title/Story name`.                                                                                             |
| `site`                                                                  | `--site [name]`                               | Also upload the built Storybook as a hosted site, so reviewers can open the live story.                                                  |
| `padding`, `delay`, `timeout`                                           | `--padding`, `--delay`, `--story-timeout`     | Pixels around the crop, milliseconds to wait after render, seconds a story may take (30).                                                |

`apiUrl`, `token`, `name`, `dir`, `clean`, `root`, `wait`, `strict` and `shard` are `@circi/vitest`'s options of the same names, with the same meanings (`CirciOptions.Common` in `@circi/cli`).

A screenshot's name gets `@<browser>` when more than one browser is configured and `@<viewport>` when more than one viewport applies: `components/button/primary@firefox@mobile`. Each PNG has a `.png.json` beside it with `{ "storyId", "browser", "viewport" }`.

If any story fails, the rest still run, every failure is listed, nothing is uploaded (a partial build would show the failed stories as removed screenshots) and the exit code is 2.

## Per story

`parameters.circi`, typed as `CirciParameters`:

```ts
import type { CirciParameters } from '@circi/storybook'

export const Open = {
  parameters: {
    circi: { viewports: ['390x844', 'wide=1440x900'], delay: 200 } satisfies CirciParameters,
  },
}
```

`skip: true` leaves the story out, `viewports` replaces the configured ones for it, `delay`, `selector` and `padding` override the options. A viewport the story chose with Storybook's Viewport addon (`globals.viewport`, or `parameters.viewport.defaultViewport` in Storybook 8) is its screenshot's viewport, unless `parameters.circi.viewports` is set.

## Exit codes

0 done (with `--wait`: the build passed); 1 with `--wait`, changes need review and this job is the gate; 2 a story failed, bad flags or setup, or the upload failed with `--strict`.

## Notes

Playwright is a peer dependency: you pick its version and install its browsers, and CirCI doesn't ship a browser. Needs Node 22 or later (22.18 or later to read `.storybook/main.ts`). Tested with Storybook 10.6 (React and Vite) and Playwright 1.65 on Chromium; the other browsers and Storybook versions use the same code paths but haven't been run.

- [CirCI documentation](https://circi.dev)
- [Changelog](https://github.com/cir-ci/repo/blob/main/packages/storybook/CHANGELOG.md)

Licensed under the GNU GPL v3.

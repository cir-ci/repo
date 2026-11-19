---
'@circi/cli': minor
'@circi/vitest': patch
---

New exports: `parseShard` (reads `2/4` as the second of four jobs) and `errorLine` (the CLI's one-line text for an error). `upload` now asks the server for the project while it reads git, and `site upload` packs the site while it looks up the branch, so both start sending sooner. `--api-url` now names CIRCI_API_URL in `--help`, where it is read from when the flag is left out.

`@circi/vitest`: the reporter uploads the screenshot folder as it is, instead of copying every screenshot to a temporary folder that was never deleted. A failed upload is reported with the CLI's error text, including its hints for the address and the token.

# @circi/cli

The `circi` command line for [CirCI](https://circi.dev), a self-hosted visual regression testing server. It uploads screenshots (and static sites) from CI to your CirCI server.

```sh
CIRCI_TOKEN=circi_… CIRCI_API_URL=https://ci.acme.io npx @circi/cli upload ./screenshots --wait
```

Or install it and run `circi upload ./screenshots --wait`. Needs Node 22 or later.

- [CLI reference](https://circi.dev/ci/cli/): every flag, environment variable and exit code.
- [CI examples](https://circi.dev/ci/ci-examples/)
- [Changelog](https://github.com/cir-ci/repo/blob/main/packages/cli/CHANGELOG.md)

Licensed under the [MIT License](LICENSE), so you can add it to any project. The CirCI server it talks to is GPL-3.0-only.

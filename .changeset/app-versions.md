---
'@circi/server': minor
---

The app has versions: each release publishes `ghcr.io/cir-ci/circi:<version>` and `circi-caddy:<version>`, `circi --version` and `/healthz` report the version a server runs, and `deploy/terraform` runs a given version on a Docker host (`circi_version`).

---
'@circi/server': patch
---

The Terraform module will be on the Terraform Registry as `cir-ci/circi/docker`, one version per release, so `source = "cir-ci/circi/docker"` with `version = "<release>"` replaces the Git URL (which keeps working). The module now reads a `Caddyfile` inside its own folder; the Caddy configuration it applies is unchanged.

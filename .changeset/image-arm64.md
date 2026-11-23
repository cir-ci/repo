---
'@circi/server': patch
---

The Docker images, `ghcr.io/cir-ci/circi` and `ghcr.io/cir-ci/circi-caddy`, are published for `linux/arm64` as well as `linux/amd64`, so CirCI runs natively on ARM servers (AWS Graviton, Ampere, a Raspberry Pi 4 or 5 with a 64-bit OS) and Apple Silicon. Docker picks the right one; nothing changes in Compose, Terraform or Helm. Each platform is built on a native runner, including the Rust diff engine.

---
'@circi/server': patch
---

CirCI now has a Helm chart for running it on an existing Kubernetes cluster such as EKS, published with each release as `oci://ghcr.io/cir-ci/charts/circi`. You bring Postgres, the S3 bucket and the IAM role; the chart runs the app (together or as separate serve and worker pods), reads secrets as files, and can run Caddy for hosted sites or use an Ingress for the dashboard. The Terraform module for a Docker host is unchanged.

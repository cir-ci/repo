#!/usr/bin/env bash
# `pnpm test:helm`: lints the chart, renders it with each values file in tests/values/ and checks the
# manifests against Kubernetes' schemas (kubeconform, skipped with a notice when it isn't installed),
# then checks that values the chart must refuse are refused. Needs helm; no cluster.
set -euo pipefail

cd "$(dirname "$0")"
chart=circi
kube_version=${KUBE_VERSION:-1.31.0}
failures=0

fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

for values in tests/values/*.yaml; do
  name=$(basename "$values" .yaml)
  echo "== $name"
  helm lint "$chart" --strict -f "$values" > /dev/null || fail "helm lint $name"
  if rendered=$(helm template circi "$chart" --namespace ci -f "$values"); then
    if command -v kubeconform > /dev/null; then
      echo "$rendered" | kubeconform -strict -summary -kubernetes-version "$kube_version" || fail "kubeconform $name"
    else
      echo "kubeconform isn't installed: the manifests were not checked against Kubernetes' schemas."
    fi
  else
    fail "helm template $name"
  fi
done

# Values the chart refuses: each case is `<why> | <helm arguments>` on top of the defaults' values.
refused() {
  local why=$1
  shift
  if helm template circi "$chart" -f tests/values/defaults.yaml "$@" > /dev/null 2>&1; then
    fail "accepted: $why"
  else
    echo "refused: $why"
  fi
}

echo "== refused"
refused 'a misspelled key' --set smtp.hots=smtp.example.com
refused 'a misspelled group' --set smptp.host=smtp.example.com
refused 'a wrong type' --set tuning.databasePoolMax=lots
refused 'a mode that does not exist' --set mode=both
refused 'a secret that is too short' --set secrets.betterAuthSecret=short
refused 'half of a group (smtp.user without its password)' --set smtp.user=mailer
refused 'smtp.host without smtp.from' --set smtp.host=smtp.example.com
refused 'split mode without S3' --set mode=split
refused 'two pods without S3' --set all.replicas=2
refused 's3 settings without a bucket' --set s3.region=eu-west-1
refused 'Caddy without its hosts' --set caddy.enabled=true
refused 'Caddy and sites.host' --set caddy.enabled=true --set caddy.dashboardHost=ci.acme.io --set caddy.sitesHost=acme-sites.com --set sites.host=acme-sites.com
refused 'Caddy and an Ingress' --set caddy.enabled=true --set caddy.dashboardHost=ci.acme.io --set caddy.sitesHost=acme-sites.com --set ingress.enabled=true
refused 'a network policy with nothing in front' --set networkPolicy.enabled=true
refused 'no database' --set database.host=null

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed." >&2
  exit 1
fi
echo "The chart is fine."

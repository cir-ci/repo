# Hosting Storybook and reports

CirCI can host the built Storybook, Playwright/Vitest report, coverage report or docs of a commit, so reviewers open the real thing next to the screenshots. It is off until you set `STATIC_SITES_HOST` and switch it on per team (team settings → **Host static sites**).

```sh
circi storybook upload ./storybook-static           # a Storybook
circi site upload ./playwright-report --name playwright
circi site upload ./coverage --kind coverage
```

Every upload belongs to a commit and gets two addresses on the sites domain:

| | Address | Serves |
|---|---|---|
| Commit | `<first 12 hex of the SHA>-<site>.acme-sites.com` | that commit's site, exactly |
| Branch | `<12 hex of sha256(branch)>-<site>.acme-sites.com` | the newest upload on that branch |

A branch address only moves when the upload is the branch's tip (`git ls-remote`, or a local check that the commit descends from what the address serves) and never for a fork's pull request. A CI re-run of a commit replaces that commit's files and keeps its address.

Every request to a site needs sign-in: opening one sends you to the dashboard, which hands the site a one-minute single-use token if you belong to the team's workspace. The site then sets its own cookie (host-only, `HttpOnly`) and checks it against your dashboard session at least once a minute, so signing out or leaving the workspace ends access within a minute. An address that doesn't exist, has expired or isn't yours gets the same answer.

## ⚠️ Step: check domain and cookie rules

A hosted site runs **arbitrary JavaScript from the build you uploaded**. Two rules keep it from reaching anything else. CirCI cannot enforce them for you.

1. **The sites domain is dedicated to CirCI.** Use a domain you serve nothing else from, not even its apex or `www`, and never set cookies on it. Browser JavaScript can set cookies for any parent domain that isn't a public suffix, so anything else on that domain shares a cookie scope with untrusted uploads. CirCI refuses a `STATIC_SITES_HOST` that equals the dashboard's host, is its parent or child, or shares its parent domain (`ci.acme.io` and `sites.acme.io` could set cookies for each other).
2. **Nothing on the dashboard's parent domain may set cookies for the whole domain** (for example `Domain=acme.io` when the dashboard is `ci.acme.io`). Uploaded code can't reach those cookies, but every such cookie is sent to the dashboard. Keep them host-scoped.

How to check: in the browser's developer tools (Application → Cookies) look at the dashboard host's parent domain and `www`, or run

```sh
curl -sI https://acme.io  | grep -i 'set-cookie.*domain='
curl -sI https://www.acme.io | grep -i 'set-cookie.*domain='
```

`circi admin doctor` does a best-effort version of this. It can't see every host, so it repeats this warning.

## DNS and TLS with Route53

- `A`/`AAAA` for the dashboard host in its own zone.
- A **new hosted zone for the sites domain** with `*` `A`/`AAAA` pointing at the server (leave the apex empty).
- Certificates: the dashboard host with HTTP-01, and `*.acme-sites.com` with **DNS-01** (needed for wildcards). `deploy/caddy` builds Caddy with the Route53 module and `deploy/Caddyfile` covers both; `docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build` runs it.

Minimal IAM policy for Caddy (on **the sites hosted zone only**):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["route53:ListHostedZonesByName", "route53:GetChange"], "Resource": "*" },
    {
      "Effect": "Allow",
      "Action": ["route53:ChangeResourceRecordSets", "route53:ListResourceRecordSets"],
      "Resource": "arn:aws:route53:::hostedzone/SITES_ZONE_ID"
    }
  ]
}
```

Terraform for both zones' records:

```hcl
resource "aws_route53_zone" "sites" { name = "acme-sites.com" }

resource "aws_route53_record" "dashboard" {
  zone_id = var.dashboard_zone_id
  name    = "ci.acme.io"
  type    = "A"
  ttl     = 300
  records = [var.server_ip]
}

resource "aws_route53_record" "sites_wildcard" {
  zone_id = aws_route53_zone.sites.zone_id
  name    = "*.acme-sites.com"
  type    = "A"
  ttl     = 300
  records = [var.server_ip]
}
```

Other DNS providers: swap `caddy-dns/route53` in `deploy/caddy/Dockerfile` and the `dns` line in the Caddyfile.

## What is not built yet

Service-worker kinds, per-kind caching and isolation headers, the sign-in handoff, forks, and the address rules are in and tested. These parts of the plan are **not**: the injected site switcher, the embedded live view in the review page, deep links from screenshots to stories, the Sites row in the pull request comment, the per-file upload transport for S3, branch expiry and slug renames (`site_slug_history`), and garbage collection of old versions. Uploads are stored in the same storage as screenshots.

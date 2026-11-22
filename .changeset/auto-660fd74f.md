---
'@circi/server': patch
---

`circi admin doctor`'s hosted-sites warning links to https://circi.dev/self-hosting/site-domains/ instead of a file in the source repository, and so do the deploy files (the Caddyfile, the Caddy overlay, `.env.example` and the Terraform module).

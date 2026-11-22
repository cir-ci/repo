---
'@circi/server': patch
---

circi admin doctor and the deploy files point at circi.dev/self-hosting/site-domains/ instead of docs/reference/static-sites.md, a path self-hosters don't have; the changeset guide (.changeset/README.md, CONTRIBUTING.md) says the app is released too, as @circi/server, and needs a changeset like the npm packages

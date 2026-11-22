---
'@circi/server': patch
---

The Terraform module works from a Windows Git checkout (it no longer relies on a symlink for its `Caddyfile`), and each version on the Terraform Registry holds the module exactly as it was released, with the license.

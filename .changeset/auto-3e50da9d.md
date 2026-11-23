---
'@circi/cypress': patch
---

A full-page screenshot of a tall page no longer times out after 4 seconds on a slow machine: the capture gets the screenshot's own time limit (its `timeout` option, or Cypress's `responseTimeout`).

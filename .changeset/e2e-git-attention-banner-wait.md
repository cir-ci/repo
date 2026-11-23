---
'@circi/e2e': patch
---

The GitHub App end-to-end test now waits for the "can't reach GitHub" banner to leave the project page, instead of counting it at the first paint, when the page is still drawn from the browser's stored copy of the project.

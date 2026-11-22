---
'@circi/e2e': patch
---

The webhook retry end-to-end test no longer fails when it catches a retry in progress: on its sped-up clock a retried job can be running its next attempt when the test looks, so it accepts pending or running, with at least two attempts.

---
'@circi/perf': patch
---

The perf suite's seed runs the admin commands from the built server bundle, as an operator runs them in the image, instead of from source. The stale "known problem" that the bundle's `admin project create` exits before printing its token is removed from the README: that was fixed on 2026-11-11.

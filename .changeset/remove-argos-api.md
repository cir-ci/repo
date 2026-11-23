---
'@circi/server': minor
'@circi/db': minor
'@circi/services': minor
'@circi/api': minor
'@circi/web': minor
---

Removed the Argos-compatible `/v2` API, which never worked with the real Argos SDKs (they reject CirCI's token format and localhost, and expect a different baseline reply). Upload with `circi upload`, the Vitest plugin or the Cypress plugin. A migration drops the unused `commit_ancestry` table and `builds.history_source`, and builds that recorded `sdk` as their baseline source now show none. The Projects empty state no longer mentions Argos.

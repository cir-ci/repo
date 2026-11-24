---
'@circi/db': patch
'@circi/auth': patch
'@circi/services': patch
'@circi/server': patch
'@circi/worker': patch
'@circi/testing': patch
'@circi/vitest-config': patch
'@circi/e2e': patch
---

Tests now run on a real Postgres server instead of PGlite, an in-process copy of Postgres. Each test file gets its own database, copied from one migrated template database on that server. Each PGlite database had used several gigabytes in the test process. Now the server holds the data, so the gate's test jobs need much less memory. On your machine, Testcontainers starts a `postgres:18-alpine` container the first time and later runs reuse it, so Docker must be running. On CI, and anywhere `CIRCI_TEST_DATABASE_URL` is set, the tests use that server instead. Production code is unchanged.

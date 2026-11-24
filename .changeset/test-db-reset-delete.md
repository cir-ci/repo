---
'@circi/db': patch
'@circi/server': patch
---

Resetting a test database between tests (`reset()` from `@circi/db/testing`, and the server tests' snapshot restore) now deletes every row instead of truncating. TRUNCATE creates new files for all 60 tables and their indexes, about 45 ms of server CPU each time. For the few rows a test leaves behind, deleting costs next to nothing. It had been half of the test Postgres server's work. Foreign keys aren't checked while the rows are deleted, and the one sequence restarts as before.

---
'@circi/server': patch
---

A worker that has just started no longer misses a delayed job queued while it was connecting to the database's notifications: it checks for work as soon as it is listening, so the job starts at its run time instead of up to a poll interval (5 seconds) later.

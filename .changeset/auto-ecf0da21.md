---
'@circi/server': patch
'@circi/web': patch
---

The server and dashboard tests run in about half the time: test files now share loaded modules instead of loading the server again for each one. Nothing changes in the app.
